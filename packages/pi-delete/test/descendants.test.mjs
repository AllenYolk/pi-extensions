import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDescendants } from "../src/descendants.ts";

/** Minimal SessionInfo; collectDescendants only reads path + parentSessionPath. */
const session = (path, parentSessionPath) => ({
  path,
  id: path,
  cwd: "/project",
  parentSessionPath,
  created: new Date(0),
  modified: new Date(0),
  messageCount: 0,
  firstMessage: "",
  allMessagesText: "",
});

const paths = (entries) => entries.map((e) => e.session.path);

test("no descendants yields empty", () => {
  const all = [session("/s/root.jsonl"), session("/s/unrelated.jsonl")];
  assert.deepEqual(collectDescendants(all, "/s/root.jsonl"), []);
});

test("collects children and grandchildren with depth", () => {
  const all = [
    session("/s/root.jsonl"),
    session("/s/child-a.jsonl", "/s/root.jsonl"),
    session("/s/child-b.jsonl", "/s/root.jsonl"),
    session("/s/grandchild.jsonl", "/s/child-a.jsonl"),
  ];
  const found = collectDescendants(all, "/s/root.jsonl");
  assert.deepEqual(paths(found).sort(), [
    "/s/child-a.jsonl",
    "/s/child-b.jsonl",
    "/s/grandchild.jsonl",
  ]);
  const depth = new Map(found.map((e) => [e.session.path, e.depth]));
  assert.equal(depth.get("/s/child-a.jsonl"), 1);
  assert.equal(depth.get("/s/child-b.jsonl"), 1);
  assert.equal(depth.get("/s/grandchild.jsonl"), 2);
});

test("unrelated trees stay separate", () => {
  const all = [
    session("/s/root.jsonl"),
    session("/s/mine.jsonl", "/s/root.jsonl"),
    session("/s/other-root.jsonl"),
    session("/s/theirs.jsonl", "/s/other-root.jsonl"),
  ];
  assert.deepEqual(paths(collectDescendants(all, "/s/root.jsonl")), ["/s/mine.jsonl"]);
});

test("cycles terminate without repeating", () => {
  const all = [
    session("/s/a.jsonl", "/s/b.jsonl"),
    session("/s/b.jsonl", "/s/a.jsonl"),
  ];
  const found = collectDescendants(all, "/s/a.jsonl");
  assert.deepEqual(paths(found), ["/s/b.jsonl"]);
});

test("self-parenting session is not its own descendant", () => {
  const all = [session("/s/loop.jsonl", "/s/loop.jsonl")];
  assert.deepEqual(collectDescendants(all, "/s/loop.jsonl"), []);
});

// --- planCascade: the active session must survive a cascade ---

const { planCascade } = await import("../src/descendants.ts");
const never = () => false;

test("plan refuses to delete the active session itself", () => {
  const all = [session("/s/root.jsonl"), session("/s/kid.jsonl", "/s/root.jsonl")];
  const plan = planCascade(all, "/s/root.jsonl", (p) => p === "/s/root.jsonl");
  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.targets, []);
});

test("plan keeps the active session when it is a descendant", () => {
  const all = [
    session("/s/root.jsonl"),
    session("/s/live.jsonl", "/s/root.jsonl"),
    session("/s/other.jsonl", "/s/root.jsonl"),
    session("/s/deep.jsonl", "/s/live.jsonl"),
  ];
  const plan = planCascade(all, "/s/root.jsonl", (p) => p === "/s/live.jsonl");
  assert.equal(plan.blocked, false);
  assert.equal(plan.skipped, 1);
  assert.ok(!plan.targets.includes("/s/live.jsonl"), "active session must not be a target");
  assert.deepEqual(plan.targets.sort(), ["/s/deep.jsonl", "/s/other.jsonl", "/s/root.jsonl"]);
});

test("plan on a leaf targets only that session", () => {
  const all = [session("/s/root.jsonl"), session("/s/leaf.jsonl", "/s/root.jsonl")];
  assert.deepEqual(planCascade(all, "/s/leaf.jsonl", never).targets, ["/s/leaf.jsonl"]);
});
