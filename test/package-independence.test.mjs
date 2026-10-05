import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { drivePi, profile, repoRoot, runPi, workspace } from './pi-collection.mjs';

/** Pack a package and unpack the real artifact, so what is installed is what npm would ship. */
function unpackedArtifact(directory) {
  const scratch = workspace(`artifact-${directory}-`);
  const pack = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], {
    cwd: join(repoRoot, 'packages', directory), encoding: 'utf8', timeout: 120000,
  });
  assert.equal(pack.status, 0, pack.stderr);
  const artifact = JSON.parse(pack.stdout)[0];
  const target = join(scratch, 'unpacked');
  mkdirSync(target);
  const extract = spawnSync('tar', ['-xzf', join(scratch, artifact.filename), '-C', target, '--strip-components=1'], {
    encoding: 'utf8', timeout: 120000,
  });
  assert.equal(extract.status, 0, extract.stderr);
  return { dir: target, manifest: JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')), artifact };
}

function activated(agent) {
  const resultFile = join(agent, 'loaded.json');
  const result = drivePi(
    ['-e', join(repoRoot, 'test/fixtures/loaded-probe.ts'),
     '--offline', '--no-session', '--no-context-files', '--no-skills', '--no-prompt-templates'],
    [{ expect: '[Extensions]', send: '/loaded-probe\r' }],
    { PI_CODING_AGENT_DIR: agent, PI_LOADED_PROBE_RESULT: resultFile },
    45,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-3000)}`);
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  return { delete: report.delete, display: report.display };
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
