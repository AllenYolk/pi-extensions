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
