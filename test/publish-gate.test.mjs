import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { git, repoRoot, workspace } from './pi-collection.mjs';

const { parse } = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))('yaml');
const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/publish.yml'), 'utf8'));
const steps = workflow.jobs.publish.steps;

test('publication requires a main SHA and its complete successful Check workflow', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const scratch = workspace('publish-gate-');
  git(scratch, 'clone', '--quiet', repoRoot, 'checkout');
  const checkout = join(scratch, 'checkout');
  const sha = git(checkout, 'rev-parse', 'HEAD');
  const remote = join(scratch, 'remote.git');
  git(scratch, 'clone', '--bare', '--quiet', repoRoot, remote);
  git(remote, 'update-ref', 'refs/heads/main', sha);
  git(checkout, 'remote', 'set-url', 'origin', remote);

  // Execute the workflow's real shell and jq filter; only the remote API is replaced.
  writeFileSync(join(scratch, 'gh'), `#!/usr/bin/env node
    import { readFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import assert from 'node:assert/strict';
    const args = process.argv.slice(2);
    assert.ok(args.includes('repos/AllenYolk/pi-extensions/actions/workflows/check.yml/runs'));
    for (const field of ['head_sha=' + process.env.PUBLISH_COMMIT, 'branch=main', 'event=push', 'per_page=1']) {
      assert.ok(args.includes(field), field);
    }
    const result = spawnSync('jq', ['-r', args[args.indexOf('--jq') + 1]], {
      input: readFileSync(process.env.API_RESPONSE), encoding: 'utf8',
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status);
  `, { mode: 0o755 });
  const env = {
    ...process.env, PATH: `${scratch}:${process.env.PATH}`, GH_REPO: 'AllenYolk/pi-extensions',
    GITHUB_REF: 'refs/heads/main', PUBLISH_COMMIT: sha, API_RESPONSE: join(scratch, 'response.json'),
  };
  const execute = (name, overrides = {}) => spawnSync('bash', ['-c', steps.find(step => step.name === name).run], {
    cwd: checkout, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000,
  });
  const dispatch = 'Require a commit SHA and the main workflow';
  assert.equal(execute(dispatch).status, 0);
  assert.notEqual(execute(dispatch, { PUBLISH_COMMIT: 'main' }).status, 0);
  assert.notEqual(execute(dispatch, { GITHUB_REF: 'refs/heads/release/test' }).status, 0);
  assert.equal(execute('Require applied version changes').status, 0);
  writeFileSync(join(checkout, '.changeset/pending.md'), '---\n"@allenyolk/pi-delete": patch\n---\nUnapplied release\n');
  assert.notEqual(execute('Require applied version changes').status, 0);

  for (const [runs, allowed] of [
    [[{ status: 'completed', conclusion: 'success' }], true],
    [[{ status: 'completed', conclusion: 'failure' }], false],
    [[{ status: 'completed', conclusion: 'cancelled' }], false],
    [[{ status: 'in_progress', conclusion: null }], false],
    [[], false],
  ]) {
    writeFileSync(env.API_RESPONSE, JSON.stringify({ workflow_runs: runs }));
    const result = execute('Refuse anything but a main commit');
    assert.equal(result.status === 0, allowed, `${JSON.stringify(runs)}: ${result.stderr}\n${result.stdout}`);
  }
});
