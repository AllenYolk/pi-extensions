import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BatchSelection } from "../src/batch-selection.ts";

const row = (path, parentSessionPath, depth = 0) => ({
  session: { path: `/sessions/${path}.jsonl`, parentSessionPath: parentSessionPath && `/sessions/${parentSessionPath}.jsonl` },
  depth,
  isLast: true,
  ancestorContinues: [],
});
const root = row("root");
const child = row("child", "root", 1);
const live = row("live", "root", 1);
const grandchild = row("grandchild", "child", 2);
const fork = row("fork", "root", 1);
const listed = [root, child, live, grandchild, fork].map((r) => r.session);
const isCurrent = (path) => path === live.session.path;

for (const [mode, rows] of [
  ["threaded", [root, child, grandchild, live]],
  ["flat and filtered", [grandchild, root, live].map((r) => ({ ...r, depth: 0 }))],
]) {
  test(`Space is per-row and t toggles only visible selectable descendants (${mode})`, () => {
    const state = new BatchSelection(rows, rows.findIndex((r) => r.session === root.session), isCurrent);
    state.toggle(false, listed);
    assert.deepEqual([...state.selected.keys()], [root.session.path]);
    state.toggle(true, listed);
    assert.deepEqual([...state.selected.keys()].sort(), rows.filter((r) => !isCurrent(r.session.path)).map((r) => r.session.path).sort());
    state.toggle(true, listed);
    assert.equal(state.selected.size, 0);
    state.move(100);
    for (const subtree of [false, true]) assert.equal(state.toggle(subtree, listed), "active");
    assert.equal(state.selected.size, 0);
  });
}

test("the same canonical mark survives empty rows and aliases, and uses fresh metadata from either scope", (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "pi-batch-marks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  const alias = join(dir, "alias.jsonl");
  writeFileSync(path, "");
  symlinkSync(path, alias);
  const target = { ...root, session: { path, modified: new Date(1), name: "Before" } };
  const aliased = { ...root, session: { ...target.session, path: alias } };
  const state = new BatchSelection([aliased], 0, isCurrent);
  state.toggle(false, []);
  state.replaceRows([]);
  assert.equal(state.hiddenCount, 1);
  const newer = { ...target.session, modified: new Date(2), name: "After" };
  state.refreshSelected([newer, target.session]);
  assert.deepEqual([...state.selected.values()], [newer]);
  state.replaceRows([target, aliased]);
  assert.equal(state.hiddenCount, 0);
  state.toggle(false, []);
  assert.equal(state.selected.size, 0);
});

test("the cursor inherits its position, follows its row through refresh, and clamps when the row is gone", () => {
  const state = new BatchSelection([root, child, live], 1, isCurrent);
  assert.equal(state.cursorRow.session.path, child.session.path);
  state.replaceRows([child, live, root]);
  assert.equal(state.cursorRow.session.path, child.session.path);
  state.move(50);
  state.replaceRows([live, child]);
  assert.equal(state.cursorRow.session.path, child.session.path);
  state.replaceRows([]);
  state.move(-50);
  assert.equal(state.cursor, 0);
  assert.equal(state.cursorRow, undefined);
});
