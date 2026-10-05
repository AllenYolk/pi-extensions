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
