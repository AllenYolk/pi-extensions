import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { deleteSessionFile } from "../src/delete-sessions.ts";

const root = mkdtempSync(join(tmpdir(), "pi-delete-"));
after(() => {
  chmodSync(join(root, "locked"), 0o755);
  rmSync(root, { recursive: true, force: true });
});

test("removes an existing file", async () => {
  const file = join(root, "gone.jsonl");
  writeFileSync(file, "{}\n");
  assert.equal(await deleteSessionFile(file), undefined);
  assert.equal(existsSync(file), false);
});

test("missing file is not an error", async () => {
  assert.equal(await deleteSessionFile(join(root, "never-existed.jsonl")), undefined);
});

test("reports an error when the file cannot be removed", async () => {
  const dir = join(root, "locked");
  mkdirSync(dir);
  const file = join(dir, "stuck.jsonl");
  writeFileSync(file, "{}\n");
  chmodSync(dir, 0o555); // blocks both trash and unlink

  const error = await deleteSessionFile(file);
  assert.ok(error, "expected an error message");
  assert.match(error, /permission|EACCES/i);
  assert.equal(existsSync(file), true, "file must survive a failed delete");
});

const { deleteSessionFiles } = await import("../src/delete-sessions.ts");

test("emptied task directories go with their sessions; anything else keeps them", async () => {
  const parent = join(root, "parent.jsonl");
  const tasks = join(root, "parent", "tasks");
  const child = join(tasks, "child.jsonl");
  mkdirSync(join(tasks, "child", "tasks"), { recursive: true });
  const grandchild = join(tasks, "child", "tasks", "grand.jsonl");
  for (const f of [parent, child, grandchild]) writeFileSync(f, "{}\n");
  assert.deepEqual(await deleteSessionFiles([parent, child, grandchild]), []);
  assert.equal(existsSync(join(root, "parent")), false, "the whole emptied tree is removed");

  const kept = join(root, "kept.jsonl");
  mkdirSync(join(root, "kept", "tasks"), { recursive: true });
  writeFileSync(kept, "{}\n");
  writeFileSync(join(root, "kept", "tasks", "notes.txt"), "user data\n");
  assert.deepEqual(await deleteSessionFiles([kept]), []);
  assert.equal(existsSync(join(root, "kept", "tasks", "notes.txt")), true, "unknown files are never removed");
});
