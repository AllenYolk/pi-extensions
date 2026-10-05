import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activated, git, profile, repoRoot, runPi, serveRepository, workspace } from './pi-collection.mjs';

const served = await serveRepository('served-');
after(() => served.close());

const declared = (agent) => JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf8')).packages ?? [];

function clonePath(agent) {
  const list = runPi(agent, ['list']);
  assert.equal(list.status, 0, list.stderr);
  const match = list.stdout.match(/^\s+(\/.*pi-extensions)\s*$/m);
  assert.ok(match, `no clone path in:\n${list.stdout}`);
  return match[1];
}

test('the git collection installs and loads both extensions from source', { timeout: 300000 }, () => {
  assert.equal(git(served.bare, 'rev-parse', 'main'), git(repoRoot, 'rev-parse', 'HEAD'));
  const agent = profile('install-root-');
  const install = runPi(agent, ['install', served.url]);
  assert.equal(install.status, 0, install.stderr);
  assert.deepEqual(declared(agent), [served.url]);

  const clone = clonePath(agent);
  assert.equal(
    existsSync(join(clone, 'packages/pi-minimal-display/dist')),
    false,
    'Pi must load the TypeScript entries without a generated dist',
  );
  assert.equal(
    existsSync(join(clone, 'node_modules/typescript')),
    false,
    'a git install omits development dependencies',
  );
  assert.deepEqual(activated(agent), { delete: true, display: true });
});

test('a detached checkout serves the exact reviewed commit without a local main', async () => {
  const scratch = workspace('detached-');
  git(scratch, 'clone', '--quiet', '--no-local', repoRoot, 'checkout');
  const checkout = join(scratch, 'checkout');
  git(checkout, 'checkout', '--quiet', '--detach');
  for (const branch of git(checkout, 'for-each-ref', '--format=%(refname)', 'refs/heads').split('\n')) {
    if (branch) git(checkout, 'update-ref', '-d', branch);
  }
  const detached = await serveRepository('served-detached-', checkout);
  try {
    git(scratch, 'clone', '--quiet', detached.url, 'restored');
    assert.equal(git(join(scratch, 'restored'), 'rev-parse', 'HEAD'), git(checkout, 'rev-parse', 'HEAD'));
  } finally {
    detached.close();
  }
});

test('a resource filter narrows the collection to one extension', { timeout: 300000 }, () => {
  for (const [only, expected] of [
    ['packages/pi-delete/src/index.ts', { delete: true, display: false }],
    ['packages/pi-minimal-display/src/index.ts', { delete: false, display: true }],
  ]) {
    const agent = profile(`filter-${only.includes('pi-delete') ? 'delete' : 'display'}-`);
    assert.equal(runPi(agent, ['install', served.url]).status, 0);
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({
      theme: 'dark',
      showCacheMissNotices: false,
      packages: [{ source: served.url, extensions: [only] }],
    }));
    assert.deepEqual(activated(agent), expected, `filter ${only}`);
  }
});

test('a pinned commit stays pinned while an unpinned source follows the branch', { timeout: 300000 }, () => {
  const head = git(served.bare, 'rev-parse', 'main');

  const pinnedAgent = profile('pinned-');
  const pinned = runPi(pinnedAgent, ['install', `${served.url}@${head}`]);
  assert.equal(pinned.status, 0, pinned.stderr);
  const pinnedClone = clonePath(pinnedAgent);
  assert.equal(git(pinnedClone, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(activated(pinnedAgent), { delete: true, display: true }, 'a pinned install loads too');

  const followingAgent = profile('following-');
  assert.equal(runPi(followingAgent, ['install', served.url]).status, 0);
  const followingClone = clonePath(followingAgent);
  assert.equal(git(followingClone, 'rev-parse', 'HEAD'), head);

  // Advance the served branch, then reconcile both installations.
  const scratch = join(served.bare, '..', 'scratch');
  git(join(served.bare, '..'), 'clone', '--quiet', served.bare, scratch);
  writeFileSync(join(scratch, 'docs/collection-update-probe.md'), '# update probe\n');
  git(scratch, 'add', 'docs/collection-update-probe.md');
  git(scratch, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'Add an update probe');
  git(scratch, 'push', '--quiet', 'origin', 'HEAD:main');
  served.publish();
  const advanced = git(served.bare, 'rev-parse', 'main');
  assert.notEqual(advanced, head);

  const pinnedUpdate = runPi(pinnedAgent, ['update', '--extensions']);
  assert.equal(pinnedUpdate.status, 0, pinnedUpdate.stderr);
  assert.equal(git(pinnedClone, 'rev-parse', 'HEAD'), head, 'a pinned ref must not advance');

  const followingUpdate = runPi(followingAgent, ['update', '--extensions']);
  assert.equal(followingUpdate.status, 0, followingUpdate.stderr);
  assert.equal(git(followingClone, 'rev-parse', 'HEAD'), advanced, 'an unpinned source follows its branch');
  assert.ok(existsSync(join(followingClone, 'docs/collection-update-probe.md')));
});

test('removing the collection clears its declaration', { timeout: 300000 }, () => {
  const agent = profile('remove-');
  assert.equal(runPi(agent, ['install', served.url]).status, 0);
  assert.deepEqual(declared(agent), [served.url]);
  const remove = runPi(agent, ['remove', served.url]);
  assert.equal(remove.status, 0, remove.stderr);
  assert.deepEqual(declared(agent), []);
});
