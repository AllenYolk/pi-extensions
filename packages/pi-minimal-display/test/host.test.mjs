import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

for (const key of ['ctrl+o', 'ctrl+g']) test(`InteractiveMode replays, branches, streams and expands images with ${key}`, { timeout: 30000 }, () => {
  mkdirSync('work', { recursive: true });
  const profile = resolve(mkdtempSync('work/host-'));
  const result = spawnSync(process.execPath, [resolve('test/fixtures/host-probe.mjs')], {
    cwd: profile,
    env: { ...process.env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: profile, PI_HOST_EXPAND_KEY: key },
    encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOST_PROBE_OK/);
});
