import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { BatchSelection } from "../src/batch-selection.ts";
import { BatchView } from "../src/batch-view.ts";

const theme = { bold: (text) => text, fg: (color, text) => color === "error" ? `\x1b[31m${text}\x1b[39m` : text };
const row = (path, firstMessage, name) => ({
  session: { path, id: path, cwd: "/project", firstMessage, allMessagesText: firstMessage, name, messageCount: 1, modified: new Date() },
  depth: 0,
  isLast: true,
  ancestorContinues: [],
});

function batch(rows, { query = "", mark = true, allRows = rows, showPath = false, active } = {}) {
  const state = new BatchSelection(rows, 0, (path) => path === active);
  let current = rows.map(({ session }) => session);
  let all = allRows.map(({ session }) => session);
  let observe = () => {};
  let scope = "current";
  const view = new BatchView(theme, state, {
    get scope() { return scope; },
    sortMode: "recent", nameFilter: "all", query, showPath,
    loading: false, loadProgress: null,
    toggleScope: () => { scope = scope === "current" ? "all" : "current"; },
    listed: () => scope === "current" ? current : all,
    bothScopes: () => [...all, ...current],
    requestRender: () => observe(view.render(80).join("\n")),
    refreshAfterDelete: async (gone) => {
      current = current.filter((session) => !gone.has(session.path));
      all = all.filter((session) => !gone.has(session.path));
    },
    close: () => view.dispose(),
  });
  const waitFor = (text) => new Promise((resolve) => {
    observe = (frame) => { if (frame.includes(text)) resolve(frame); };
  });
  for (const _ of mark ? rows : []) {
    view.handleInput(" ");
    view.handleInput("\x1b[B");
  }
  return { view, waitFor, reloadAll: (sessions) => { all = sessions; } };
}

const rangeRows = [row("/first.jsonl", "first row"), row("/live.jsonl", "live row"), row("/last.jsonl", "last row")];
for (const [i, { session }] of rangeRows.entries()) session.modified = new Date(3 - i);

test("g and G jump to the visible endpoints with plain and Kitty input", () => {
  for (const visible of [rangeRows, rangeRows.slice(0, 1), []]) {
    const { view } = batch(visible, { mark: false });
    for (const [key, label] of [["G", "last"], ["g", "first"], ["\x1b[103:71;2u", "last"], ["\x1b[103u", "first"],
      ["\x1b[103;2u", "last"], ["\x1b[71u", "last"], ["g", "first"]]) {
      view.handleInput(key);
      const frame = stripTerminalSequences(view.render(80).join("\n"));
      if (!visible.length) assert.match(frame, /No matching sessions/);
      else assert.match(frame, new RegExp(`› \\[ \\] ${visible.length === 1 ? "first" : label} row`));
    }
  }
});

test("range keys preview forward and backward without marking until Space or v", () => {
  const { view } = batch(rangeRows, { mark: false, active: "/live.jsonl" });
  const frame = () => stripTerminalSequences(view.render(80).join("\n"));
  view.handleInput("v");
  assert.match(frame(), /Range anchor.*Space\/v mark.*Esc cancel/);
  assert.match(frame(), /›│ \[ \] first row/);
  assert.doesNotMatch(frame(), /│ \[-\] live row/);
  view.handleInput("\x1b[B");
  assert.match(frame(), /›│ \[-\] live row/);
  view.handleInput("\x1b[A");
  assert.match(frame(), /›│ \[ \] first row/);
  for (const key of ["\x1b[6~", "\x1b[103:71;2u"]) {
    view.handleInput(key);
    assert.match(frame(), /│ \[ \] first row[^\n]*\n │ \[-\] live row[^\n]*\n›│ \[ \] last row/);
    assert.match(frame(), /0 selected/);
    view.handleInput("\x1b[5~");
    assert.match(frame(), /›│ \[ \] first row/);
  }
  view.handleInput("G");
  view.handleInput(" ");
  assert.match(frame(), /2 selected/);
  assert.match(frame(), /\[x\] first row[^\n]*\n  \[-\] live row[^\n]*\n› \[x\] last row/);
  assert.doesNotMatch(frame(), /Range anchor/);
  view.handleInput("v");
  view.handleInput("\x1b[103u");
  assert.match(frame(), /›│ \[x\] first row[^\n]*\n │ \[-\] live row[^\n]*\n │ \[x\] last row/);
  view.handleInput("v");
  assert.match(frame(), /2 selected/);
  assert.match(frame(), /› \[x\] first row/);
  assert.doesNotMatch(frame(), /Range anchor/);
});

test("an anchored preview ignores list shortcuts and Esc keeps existing marks in Batch mode", () => {
  const { view } = batch(rangeRows, { mark: false });
  const frame = () => stripTerminalSequences(view.render(80).join("\n"));
  for (const key of [" ", "\x1b[B", "v", "G", "/", "\t", "n", "o", "m", "s", "p", "d", "\r", "t", "a", "i", "c"]) view.handleInput(key);
  assert.match(frame(), /Range anchor/);
  assert.match(frame(), /Current Folder · Recent · All Names · Any age · Any length · Paths off/);
  assert.match(frame(), /  \[x\] first row[^\n]*\n │ \[ \] live row[^\n]*\n›│ \[ \] last row/);
  view.handleInput("\x1b");
  assert.match(frame(), /Batch Delete · 1 selected/);
  assert.match(frame(), /› \[ \] last row/);
  assert.doesNotMatch(frame(), /Range anchor|│/);
  assert.match(frame(), /PgUp\/PgDn\/g\/G move.*v range\n.*a toggle all · i invert · c clear all.*Esc back/);
});

test("range jumps on empty and one-row lists are safe and cannot mark the active session", () => {
  const { view } = batch([rangeRows[1]], { active: "/live.jsonl", mark: false });
  for (const key of ["v", "G", "g"]) view.handleInput(key);
  assert.match(view.render(80).join("\n"), /›│ \[-\] live row/);
  view.handleInput(" ");
  const frame = view.render(80).join("\n");
  assert.match(frame, /Cannot select the currently active session/);
  assert.match(frame, /0 selected/);
  assert.doesNotMatch(frame, /Range anchor/);
  const empty = batch([], { mark: false }).view;
  for (const key of ["v", "G", "g"]) empty.handleInput(key);
  const emptyFrame = empty.render(80).join("\n");
  assert.match(emptyFrame, /No matching sessions/);
  assert.doesNotMatch(emptyFrame, /Range anchor/);
});

test("an incoming scope refresh cancels an anchor before a stale commit key can mark another row", () => {
  const { view, reloadAll } = batch(rangeRows, { mark: false });
  for (const key of ["\t", "G", "v", "g"]) view.handleInput(key);
  assert.match(view.render(80).join("\n"), /Range anchor/);
  reloadAll([row("/replacement.jsonl", "replacement").session]);
  view.handleInput(" ");
  const frame = view.render(80).join("\n");
  assert.match(frame, /Batch Delete · 0 selected/);
  assert.match(frame, /› \[ \] replacement/);
  assert.doesNotMatch(frame, /Range anchor/);
});

test("search edits the inherited query without invoking Batch actions and keeps marks on Enter or Esc", () => {
  const { view } = batch([row("/one.jsonl", "cleanup one"), row("/two.jsonl", "cleanup two")], { query: "cleanup", mark: false });
  const frame = () => stripTerminalSequences(view.render(80).join("\n"));
  view.handleInput(" ");
  view.handleInput("/");
  assert.match(frame(), /Search> cleanup/);
  for (const key of [" ", "n", "o", "m", "s", "p", "d", "t", "\t", "\x1b"]) view.handleInput(key);
  assert.match(frame(), /Search: cleanup nomspdt/);
  assert.match(frame(), /Batch Delete · 1 selected/);
  assert.match(frame(), /No matching sessions/);
  view.handleInput("/");
  view.handleInput("\x15");
  view.handleInput('"cleanup one"');
  view.handleInput("\r");
  assert.match(frame(), /\[x\] cleanup one/);
  assert.doesNotMatch(frame(), /Search>|cleanup two/);
});

test("name, age, message, sort, and path controls compose in Batch list mode", () => {
  const rows = [row("/sessions/old.jsonl", "old short"), row("/sessions/long.jsonl", "old long"),
    row("/sessions/named.jsonl", "named", "deliberate"), row("/sessions/new.jsonl", "new short")];
  for (const r of rows.slice(0, 3)) r.session.modified = new Date(Date.now() - 10 * 86_400_000);
  rows[1].session.messageCount = 3;
  const { view } = batch(rows, { mark: false });
  const frame = () => stripTerminalSequences(view.render(100).join("\n"));
  for (const key of ["n", "o", "m", "s", "\x1b[112u"]) view.handleInput(key);
  assert.match(frame(), /Fuzzy · Unnamed · >7d · ≤2 msgs · Paths on/);
  assert.match(frame(), /old short.*\/sessions\/old.jsonl/);
  assert.doesNotMatch(frame(), /old long|new short|deliberate/);
  view.handleInput("o");
  assert.match(frame(), />30d/);
  assert.match(frame(), /No matching sessions/);
  view.handleInput("o");
  view.handleInput("n");
  assert.match(frame(), /Named · Any age/);
  assert.match(frame(), /deliberate/);
  for (const key of ["n", "m", "s", "p"]) view.handleInput(key);
  assert.match(frame(), /Threaded · All Names · Any age · Any length · Paths off/);
  assert.match(frame(), /old long/);
  assert.doesNotMatch(frame(), /\/sessions\//);
});

test("path metadata inherits the native toggle, abbreviates home, and can fit the All scope cwd", () => {
  const entry = row(join(homedir(), "sessions", "long-directory".repeat(5), "session.jsonl"), "path candidate");
  entry.session.cwd = join(homedir(), "projects", "long-directory".repeat(5), "other-folder");
  const { view } = batch([entry], { mark: false, showPath: true });
  const frame = () => stripTerminalSequences(view.render(100).join("\n"));
  assert.match(frame(), /path candidate[^\n]*~\/sessions\/[^\n]*session\.jsonl/);
  assert.doesNotMatch(frame(), /other-folder/);
  view.handleInput("\t");
  assert.match(frame(), /path candidate[^\n]*session\.jsonl[^\n]*other-folder/);
  view.handleInput("p");
  assert.match(frame(), /path candidate[^\n]*other-folder/);
  assert.doesNotMatch(frame(), /session\.jsonl/);
});

test("an age-filtered view includes a session when its strict cutoff passes", (t) => {
  const now = 100 * 86_400_000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const entry = row("/cutoff.jsonl", "newly eligible");
  entry.session.modified = new Date(now - 7 * 86_400_000);
  const { view } = batch([entry], { mark: false });
  view.handleInput("o");
  assert.doesNotMatch(view.render(80).join("\n"), /newly eligible/);
  t.mock.timers.tick(1);
  assert.match(view.render(80).join("\n"), /newly eligible/);
});

test("confirmation puts named rows first, bounds the list, scrolls to the end, and cancels without clearing selection", { timeout: 2000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-batch-review-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = Array.from({ length: 31 }, (_, i) => row(join(dir, `${i}.jsonl`), `target ${i}`));
  rows[26].session.name = "Deliberate work";
  const { view, waitFor } = batch(rows);
  const ready = waitFor("Delete 31 sessions?");
  view.handleInput("d");
  const firstFrame = await ready;
  assert.match(firstFrame, /\x1b\[31mWarning: named sessions[^\n]+\n\x1b\[31m\[named\] Deliberate work/);
  assert.doesNotMatch(firstFrame, /target 30/);
  const narrow = view.render(16);
  assert.ok(narrow.length <= 15);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 16));
  for (let i = 0; i < 31; i++) view.handleInput("\x1b[6~");
  assert.match(view.render(80).join("\n"), /target 30/);
  view.handleInput("\x1b");
  assert.match(view.render(80).join("\n"), /Batch Delete · 31 selected/);
});

test("confirmation deletes the full selection across scope and search with the latest name and nested tasks", { timeout: 2000 }, async (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "pi-batch-scopes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const marked = row(join(dir, "marked.jsonl"), "marked local");
  const other = row(join(dir, "other.jsonl"), "marked elsewhere");
  const keep = row(join(dir, "fork.jsonl"), "unmarked fork");
  keep.session.parentSessionPath = other.session.path;
  const allRows = [marked, other, keep];
  const modified = new Date();
  for (const { session } of allRows) {
    session.modified = modified;
    writeFileSync(session.path, "{}\n");
  }
  const task = join(dir, "other/tasks/task.jsonl");
  const nested = join(dir, "other/tasks/task/tasks/nested.jsonl");
  mkdirSync(join(dir, "other/tasks/task/tasks"), { recursive: true });
  const transcript = (path) => [
    { type: "session", version: 3, id: path, timestamp: new Date().toISOString(), cwd: dir },
    { type: "message", id: "first", parentId: null, timestamp: new Date().toISOString(),
      message: { role: "user", content: "hidden work", timestamp: Date.now() } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  for (const path of [task, nested]) writeFileSync(path, transcript(path));

  const { view, waitFor, reloadAll } = batch([marked, keep], { mark: false, allRows });
  const frame = () => stripTerminalSequences(view.render(80).join("\n"));
  for (const key of [" ", "\t", "\x1b[B", " ", "\t"]) view.handleInput(key);
  assert.match(frame(), /2 selected \(1 hidden\)/);
  reloadAll([marked.session, { ...other.session, modified: new Date(Date.now() + 1000), name: "Latest deliberate name" }, keep.session]);
  for (const key of ["/", '"unmarked fork"', "\x1b"]) view.handleInput(key);
  assert.match(frame(), /2 selected \(2 hidden\)/);
  const ready = waitFor("Delete 4 sessions (2 hidden)?");
  view.handleInput("d");
  assert.match(await ready, /\x1b\[31m\[named\] Latest deliberate name[^\n]+\nmarked local/);
  const deleted = waitFor("Deleted 4 sessions (2 hidden)");
  view.handleInput("\r");
  assert.match(await deleted, /0 selected/);
  assert.ok([marked.session.path, other.session.path, task, nested].every((path) => !existsSync(path)));
  assert.ok(existsSync(keep.session.path));
  for (const key of ["/", "\x15", "\r", "\t"]) view.handleInput(key);
  assert.doesNotMatch(frame(), /marked local|Latest deliberate name|marked elsewhere/);
});

test("partial deletion refreshes the list but leaves the failed row marked", { timeout: 2000 }, async (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "pi-batch-failure-"));
  const locked = join(dir, "locked");
  mkdirSync(locked);
  t.after(() => {
    chmodSync(locked, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });
  const gone = join(dir, "gone.jsonl");
  const stuck = join(locked, "stuck.jsonl");
  for (const path of [gone, stuck]) writeFileSync(path, "{}\n");
  chmodSync(locked, 0o555);

  const { view, waitFor } = batch([row(gone, "removable session"), row(stuck, "locked session")]);
  const ready = waitFor("Delete 2 sessions?");
  view.handleInput("\r");
  await ready;
  const deleted = waitFor("Deleted 1 session · failed 1");
  view.handleInput("\r");
  const frame = stripTerminalSequences(await deleted);
  assert.match(frame, /Batch Delete · 1 selected/);
  assert.match(frame, /failed 1: stuck\.jsonl/);
  assert.match(frame, /\[x\] locked session/);
  assert.doesNotMatch(frame, /removable session/);
  assert.equal(existsSync(gone), false);
  assert.equal(existsSync(stuck), true);
});
