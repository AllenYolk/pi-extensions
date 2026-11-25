import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { BatchSelection } from "../src/batch-selection.ts";
import { BatchView } from "../src/batch-view.ts";

const theme = { bold: (text) => text, fg: (color, text) => color === "error" ? `\x1b[31m${text}\x1b[39m` : text };
const row = (path, firstMessage, name) => ({
  session: { path, firstMessage, name, messageCount: 1, modified: new Date() },
  depth: 0,
  isLast: true,
  ancestorContinues: [],
});

function batch(rows) {
  const state = new BatchSelection(rows, 0, () => false);
  let observe = () => {};
  const view = new BatchView(theme, state, {
    scope: "current", sortMode: "recent", nameFilter: "all", query: "",
    rows: () => rows,
    listed: () => rows.map(({ session }) => session),
    requestRender: () => observe(view.render(80).join("\n")),
    refreshAfterDelete: async (gone) => { rows = rows.filter(({ session }) => !gone.has(session.path)); },
    close: () => view.dispose(),
  });
  const waitFor = (text) => new Promise((resolve) => {
    observe = (frame) => { if (frame.includes(text)) resolve(frame); };
  });
  for (const _ of rows) {
    view.handleInput(" ");
    view.handleInput("\x1b[B");
  }
  return { view, waitFor };
}

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
