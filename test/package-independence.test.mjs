import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { activated, profile, repoRoot, runPi, workspace } from './pi-collection.mjs';

/** Pack a package and unpack the real artifact, so what is installed is what npm would ship. */
function unpackedArtifact(directory) {
  const scratch = workspace(`artifact-${directory}-`);
  const pack = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], {
    cwd: join(repoRoot, 'packages', directory), encoding: 'utf8', timeout: 120000,
  });
  assert.equal(pack.status, 0, pack.stderr);
  const parsed = JSON.parse(pack.stdout);
  const artifact = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const target = join(scratch, 'unpacked');
  mkdirSync(target);
  const extract = spawnSync('tar', ['-xzf', join(scratch, artifact.filename), '-C', target, '--strip-components=1'], {
    encoding: 'utf8', timeout: 120000,
  });
  assert.equal(extract.status, 0, extract.stderr);
  return { dir: target, manifest: JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) };
}

// Pi records a local package as a path relative to the settings file, and identifies it by
// its resolved absolute path.
const declared = (agent) =>
  (JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf8')).packages ?? [])
    .map(entry => resolve(agent, typeof entry === 'string' ? entry : entry.source));

for (const [directory, expected] of [
  ['pi-delete', { delete: true, display: false }],
  ['pi-minimal-display', { delete: false, display: true }],
]) {
  test(`${directory} installs, loads and removes on its own`, { timeout: 300000 }, () => {
    const { dir, manifest } = unpackedArtifact(directory);

    // Nothing in the artifact may pull in the other package or a Pi runtime copy.
    assert.deepEqual(manifest.dependencies ?? {}, {});
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
      assert.equal(manifest.scripts?.[key], undefined, `${key} lifecycle script must not ship`);
    }
    assert.equal(manifest.repository.directory, `packages/${directory}`);
    assert.ok(existsSync(join(dir, manifest.pi.extensions[0])), 'the declared source entry must ship');

    const agent = profile(`solo-${directory}-`);
    const install = runPi(agent, ['install', dir]);
    assert.equal(install.status, 0, install.stderr);
    assert.deepEqual(declared(agent), [dir]);

    assert.deepEqual(activated(agent), expected, 'only the installed extension may activate');

    const remove = runPi(agent, ['remove', dir]);
    assert.equal(remove.status, 0, remove.stderr);
    assert.deepEqual(declared(agent), []);
    assert.deepEqual(activated(agent), { delete: false, display: false }, 'removal must deactivate it');
  });
}
