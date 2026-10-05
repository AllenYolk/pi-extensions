import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCliProbe } from './run-cli.mjs';

test('the actual tarball contains a self-contained Pi entry and loads without peer installation', { timeout: 60000 }, () => {
  mkdirSync('work', { recursive: true });
  const workspace = resolve(mkdtempSync('work/package-'));
  const pack = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', workspace], { encoding: 'utf8', timeout: 20000 });
  assert.equal(pack.status, 0, pack.stderr);
  const packed = JSON.parse(pack.stdout);
  const artifact = Array.isArray(packed) ? packed[0] : packed[Object.keys(packed)[0]];
  assert.deepEqual(artifact.files.map(file => file.path).sort(), ['LICENSE', 'README.md', 'package.json', 'src/config.ts', 'src/index.ts', 'src/presentation.ts']);
  const profile = join(workspace, 'profile');
  mkdirSync(profile);
  writeFileSync(join(profile, 'package.json'), '{"private":true}\n');
  const install = spawnSync('npm', ['install', join(workspace, artifact.filename), '--prefix', profile, '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(install.status, 0, install.stderr);
  const packageDir = join(profile, 'node_modules/@allenyolk/pi-minimal-display');
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(manifest.license, 'MIT');
  for (const key of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(manifest.scripts[key], undefined);
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  assert.deepEqual(manifest.peerDependencies, { '@earendil-works/pi-coding-agent': '*', '@earendil-works/pi-tui': '*' });
  assert.equal(existsSync(join(profile, 'node_modules/@earendil-works/pi-coding-agent')), false);
  runCliProbe(join(packageDir, manifest.pi.extensions[0]), 2, profile);
});
