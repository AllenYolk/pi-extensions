import assert from "node:assert/strict";
import { test } from "node:test";
import { projectBatchRows } from "../src/batch-rows.ts";

const batchRows = (...args) => projectBatchRows(...args).rows;

const day = 86_400_000;
const now = 100 * day;
const session = (path, { days = 0, text = "", ...fields } = {}) => ({
  path, id: path, cwd: "/project", modified: new Date(now - days * day), messageCount: 2,
  firstMessage: text, allMessagesText: text, ...fields,
});
const paths = (matches) => matches.map(({ session }) => session.path);

test("search supports fuzzy tokens, normalized phrases, regex, and relevance with recent tie-breaking", () => {
  const older = session("a", { days: 2, text: "Build\n   CACHE ready" });
  const newer = session("b", { days: 1, text: "Build\tCACHE ready" });
  const closest = session("c", { days: 3, name: "Build CACHE", text: "ready" });
  const separate = session("d", { text: "build remote cache", cwd: "/work/ready" });
  const pool = [older, separate, newer, closest];
  const filters = { nameFilter: "all", sortMode: "relevance", olderThanDays: 0, shortOnly: false };
  const search = (query) => paths(batchRows(pool, filters, query));
  assert.deepEqual(search('"BUILD  CACHE" rdy'), ["c", "b", "a"]);
  assert.deepEqual(search("bld cch rdy").sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(search("re:build\\s+cache"), ["c", "b", "a"]);
  assert.deepEqual(search("re:["), []);
  assert.deepEqual(search("re:  "), []);
  assert.deepEqual(search("  "), ["d", "b", "a", "c"]);
});

test("cleanup filters compose, with strict age cutoffs and a clock independent of the system date", () => {
  const sessions = [
    session("older", { days: 31, name: "  ", text: "needle" }),
    session("month", { days: 30, text: "needle" }),
    session("week", { days: 7, text: "needle" }),
    session("long", { days: 8, text: "needle", messageCount: 3 }),
    session("named", { days: 9, name: "Keep", text: "needle" }),
    session("different", { days: 40, text: "haystack" }),
  ];
  const filters = { nameFilter: "unnamed", sortMode: "recent", olderThanDays: 7, shortOnly: true };
  assert.deepEqual(paths(batchRows(sessions, filters, '"needle"', now)), ["month", "older"]);
  assert.deepEqual(paths(batchRows(sessions, { ...filters, olderThanDays: 30 }, "needle", now)), ["older"]);
  assert.deepEqual(paths(batchRows(sessions, { ...filters, nameFilter: "named" }, "", now)), ["named"]);
});

test("threaded rows use subtree activity, promote children of hidden parents and keep cycles finite", () => {
  const sessions = [
    session("root", { days: 9 }),
    session("older-child", { days: 8, parentSessionPath: "root" }),
    session("branch", { days: 7, parentSessionPath: "root" }),
    session("newest", { parentSessionPath: "branch" }),
    session("recent-root", { days: 1 }),
    session("filtered-parent", { days: 10, name: "hidden" }),
    session("promoted", { days: 3, parentSessionPath: "filtered-parent" }),
    session("cycle-leaf", { days: 6, parentSessionPath: "cycle-a" }),
    session("cycle-a", { days: 6, parentSessionPath: "cycle-b" }),
    session("cycle-b", { days: 4, parentSessionPath: "cycle-a" }),
    session("self", { days: 5, parentSessionPath: "self" }),
  ];
  const filters = { nameFilter: "unnamed", olderThanDays: 0, shortOnly: false, sortMode: "threaded" };
  const threaded = batchRows(sessions, filters, "", now);
  assert.deepEqual(threaded.map(({ session, depth, isLast, ancestorContinues }) => [session.path, depth, isLast, ancestorContinues]), [
    ["root", 0, false, []], ["branch", 1, false, [true]], ["newest", 2, true, [true, true]],
    ["older-child", 1, true, [true]], ["recent-root", 0, false, []], ["promoted", 0, false, []],
    ["cycle-a", 0, false, []], ["cycle-b", 1, false, [true]], ["cycle-leaf", 1, true, [true]], ["self", 0, true, []],
  ]);
  assert.deepEqual(paths(batchRows(sessions, { ...filters, sortMode: "recent" }, "", now)),
    ["newest", "recent-root", "promoted", "cycle-b", "self", "cycle-leaf", "cycle-a", "branch", "older-child", "root"]);
  assert.deepEqual(paths(batchRows(sessions, filters, "re:branch|newest", now)), ["newest", "branch"]);
});
