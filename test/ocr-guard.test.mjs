// SPDX-License-Identifier: Apache-2.0
// Adapted from SpikingJelly test/test_ocr_guard.py.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, workspace } from './pi-collection.mjs';

test('OCR distinguishes completed reviews, empty failures and useful partial findings', () => {
  const scratch = workspace('ocr-guard-');
  const guardDir = join(scratch, 'guard');
  const cliDir = join(scratch, 'cli');
  mkdirSync(guardDir);
  mkdirSync(cliDir);
  const resultPath = join(scratch, 'result.json');
  const source = readFileSync(join(repoRoot, '.github/scripts/ocr'), 'utf8');
  assert.equal(source.split('/tmp/ocr-result.json').length, 2);
  const guard = join(guardDir, 'ocr');
  writeFileSync(guard, source.replace('/tmp/ocr-result.json', resultPath), { mode: 0o755 });
  for (const [status, cliExit, findings, expected, warning] of [
    ['complete', 0, [], 0, false],
    ['success', 0, [], 0, false],
    ['skipped', 0, [], 0, false],
    ['partial', 0, [], 1, true],
    ['error', 0, [], 1, true],
    ['complete', 2, [], 2, false],
    ['complete', 0, [{ body: 'finding' }], 0, false],
    ['partial', 1, [{ body: 'finding' }], 0, true],
  ]) {
    writeFileSync(resultPath, JSON.stringify({ status, comments: findings }));
    writeFileSync(join(cliDir, 'ocr'), `#!/bin/sh\nexit ${cliExit}\n`, { mode: 0o755 });
    const result = spawnSync('bash', [guard, 'review'], {
      env: { ...process.env, PATH: `${guardDir}:${cliDir}:${process.env.PATH}` },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, expected, result.stderr);
    assert.equal(Boolean(result.stderr), warning);
  }
});
