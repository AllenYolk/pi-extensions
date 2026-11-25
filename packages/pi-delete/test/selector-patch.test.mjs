import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const profile = mkdtempSync(join(tmpdir(), "pi-batch-selector-"));
process.env.PI_CODING_AGENT_DIR = profile;
after(() => rmSync(profile, { recursive: true, force: true }));
const { initTheme, SessionSelectorComponent } = await import("@earendil-works/pi-coding-agent");
const { default: sessionDelete } = await import("../src/index.ts");
initTheme("dark");

const selector = () => new SessionSelectorComponent(async () => [], async () => [], () => {}, () => {}, () => {}, () => {});
const prototype = SessionSelectorComponent.prototype;
const headerPrototype = Object.getPrototypeOf(selector().header);
const originalSelector = Object.getOwnPropertyDescriptors(prototype);
const originalHeader = Object.getOwnPropertyDescriptors(headerPrototype);

function start(t) {
  const handlers = new Map();
  const warnings = [];
  sessionDelete({ on: (event, fn) => handlers.set(event, fn), registerCommand() {} });
  handlers.get("session_start")({}, {
    mode: "tui", hasUI: true,
    ui: { theme: { bold: (text) => text, fg: (_color, text) => text }, notify: (text, level) => warnings.push([text, level]) },
  });
  const shutdown = handlers.get("session_shutdown");
  t.after(shutdown);
  return { shutdown, warnings };
}

test("an incompatible picker forwards ctrl+x unchanged and warns only once", (t) => {
  const { warnings } = start(t);
  const forwarded = [];
  const malformed = selector();
  malformed.sessionList.selectedIndex = "not an index";
  malformed.sessionList.handleInput = (key) => forwarded.push(key);
  malformed.handleInput("\x18");
  malformed.handleInput("\x18");
  assert.deepEqual(forwarded, ["\x18", "\x18"]);
  assert.deepEqual(warnings, [["pi-delete: session picker internals changed; Batch mode disabled", "warning"]]);
  assert.doesNotMatch(malformed.render(80).join("\n"), /Batch Delete/);
});

test("a missing scope toggle keeps Batch disabled without intercepting native input", (t) => {
  const { warnings } = start(t);
  const picker = selector();
  const forwarded = [];
  picker.toggleScope = undefined;
  picker.sessionList.handleInput = (key) => forwarded.push(key);
  picker.handleInput("\x18");
  assert.deepEqual(forwarded, ["\x18"]);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(picker.render(80).join("\n"), /Batch Delete/);
});

test("Batch follows Pi's async scope progress and returns to the loaded native scope", async (t) => {
  start(t);
  const session = (id) => ({
    id, path: `/${id}.jsonl`, cwd: "/project", created: new Date(), modified: new Date(),
    messageCount: 2, firstMessage: id, allMessagesText: id,
  });
  const current = session("current-row");
  const partial = session("first-other-row");
  const complete = session("second-other-row");
  let reportProgress, finish;
  let picker;
  let frame;
  picker = new SessionSelectorComponent(async () => [current], (progress) => {
    reportProgress = progress;
    return new Promise((resolve) => { finish = resolve; });
  }, () => {}, () => {}, () => {}, () => { frame = picker?.render(100).join("\n"); });
  await Promise.resolve();
  picker.handleInput("\x18");
  picker.handleInput("\t");
  assert.match(frame, /All Folders/);
  assert.match(frame, /Loading sessions…/);
  assert.doesNotMatch(frame, /current-row/);
  reportProgress(1, 2, [partial]);
  assert.match(frame, /Loading sessions… 1\/2/);
  assert.match(frame, /first-other-row/);
  assert.doesNotMatch(frame, /second-other-row/);
  picker.handleInput("\t");
  assert.match(frame, /current-row/);
  assert.doesNotMatch(frame, /Loading sessions|first-other-row/);
  picker.handleInput("\t");
  finish([partial, complete]);
  await Promise.resolve();
  assert.match(frame, /second-other-row/);
  assert.doesNotMatch(frame, /Loading sessions/);
  picker.handleInput("\x1b");
  assert.match(frame, /Resume Session \(All\)/);
  assert.match(frame, /second-other-row/);
  assert.doesNotMatch(frame, /Batch Delete/);
});

test("Batch shows a failed scope load and can return to the working scope", async (t) => {
  start(t);
  const picker = new SessionSelectorComponent(async () => [], async () => { throw new Error("fixture unavailable"); },
    () => {}, () => {}, () => {}, () => {});
  await Promise.resolve();
  picker.handleInput("\x18");
  picker.handleInput("\t");
  await Promise.resolve();
  assert.match(picker.render(100).join("\n"), /Failed to load sessions: fixture unavailable/);
  picker.handleInput("\t");
  assert.match(picker.render(100).join("\n"), /Current Folder/);
  picker.handleInput("\x1b");
  picker.handleInput("\x1b");
});

test("a layout hook that rejects the Batch body falls back to native input and keeps the picker usable", (t) => {
  const { warnings } = start(t);
  const picker = selector();
  const forwarded = [];
  picker.sessionList.handleInput = (key) => forwarded.push(key);
  const layout = picker.buildBaseLayout;
  picker.buildBaseLayout = function (body, options) {
    // A future host may accept only its native components and reject a custom layout.
    if (body !== this.sessionList) {
      this.clear();
      throw new TypeError("unrecognized body");
    }
    return layout.call(this, body, options);
  };
  picker.handleInput("\x18");
  assert.deepEqual(forwarded, ["\x18"]);
  assert.equal(warnings.length, 1);
  assert.match(picker.render(80).join("\n"), /re:<pattern>/);
});

test("the native cascade hint still attaches on input without buildBaseLayout", (t) => {
  const picker = selector();
  delete prototype.buildBaseLayout;
  t.after(() => Object.defineProperty(prototype, "buildBaseLayout", originalSelector.buildBaseLayout));
  const { warnings } = start(t);
  picker.handleInput("\x18");
  assert.deepEqual(warnings, [["pi-delete: session picker internals changed; Batch mode disabled", "warning"]]);

  picker.sessionList.setConfirmingDeletePath("/synthetic.jsonl");
  assert.match(picker.header.render(100)[1], /Delete session\?.*subtree/);
});

test("shutdown restores the live layout and both native prototypes", (t) => {
  const { shutdown } = start(t);
  const picker = selector();
  assert.match(picker.header.render(80)[1], /ctrl\+x/);
  assert.doesNotMatch(picker.header.render(50)[1], /ctrl\+x/);
  picker.sessionList.setConfirmingDeletePath("/synthetic.jsonl");
  assert.match(picker.header.render(100)[1], /Delete session\?.*subtree/);
  assert.doesNotMatch(picker.header.render(100)[1], /ctrl\+x/);
  picker.sessionList.setConfirmingDeletePath(null);

  picker.handleInput("\x18");
  assert.match(picker.render(80).join("\n"), /Batch Delete/);
  shutdown();
  assert.deepEqual(Object.getOwnPropertyDescriptors(prototype), originalSelector);
  assert.deepEqual(Object.getOwnPropertyDescriptors(headerPrototype), originalHeader);
  assert.match(picker.render(80).join("\n"), /re:<pattern>/);
  assert.doesNotMatch(picker.render(80).join("\n"), /Batch Delete|ctrl\+x/);
});
