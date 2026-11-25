import assert from "node:assert/strict";
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
    assert.deepEqual([...state.selected], [root.session.path]);
    state.toggle(true, listed);
    assert.deepEqual([...state.selected].sort(), rows.filter((r) => !isCurrent(r.session.path)).map((r) => r.session.path).sort());
    state.toggle(true, listed);
    assert.deepEqual([...state.selected], []);
    state.move(100);
    for (const subtree of [false, true]) assert.equal(state.toggle(subtree, listed), "active");
    assert.equal(state.selected.size, 0);
  });
}

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
