import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const testDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = dirname(testDir);

const piHostDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const piCli = join(piHostDir, 'dist/bundle/cli.js');
export const deleteEntry = join(repoRoot, 'packages/pi-delete/src/index.ts');
export const displayEntry = join(repoRoot, 'packages/pi-minimal-display/src/index.ts');
const driver = join(testDir, 'pty-drive.py');

// Pi clones through git, which honours the developer's global proxy settings. The served
// repository is on loopback, so both the proxy and its git config override are cleared.
const loopbackGitEnv = {
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.proxy',
  GIT_CONFIG_VALUE_0: '',
};

export function workspace(prefix) {
  const work = join(repoRoot, 'work');
  mkdirSync(work, { recursive: true });
  return realpathSync(resolve(mkdtempSync(join(work, prefix))));
}

/** A disposable Pi profile. Nothing here reads or writes the real ~/.pi directory. */
export function profile(prefix, settings = {}) {
  const dir = workspace(prefix);
  // Startup help stays on: the scripts wait for the `[Extensions]` block, which is the
  // first output that proves Pi finished loading its entries.
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', showCacheMissNotices: false, ...settings }),
  );
  return dir;
}

export function activated(agent) {
  const resultFile = join(agent, 'loaded.json');
  const result = drivePi(
    ['-e', join(testDir, 'fixtures/loaded-probe.ts'),
     '--offline', '--no-session', '--no-context-files', '--no-skills', '--no-prompt-templates'],
    [{ expect: '[Extensions]', send: '/loaded-probe\r' }],
    { PI_CODING_AGENT_DIR: agent, PI_LOADED_PROBE_RESULT: resultFile },
    45,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-3000)}`);
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  assert.equal(report.hasUI, true);
  return { delete: report.delete, display: report.display };
}

/**
 * A synthetic session tree: one root, two children, one grandchild. realpath matters —
 * a session whose recorded cwd differs from Pi's resolved cwd triggers the fork prompt.
 */
export function sessionTree(root) {
  mkdirSync(root, { recursive: true });
  const base = realpathSync(root);
  const proj = join(base, 'proj');
  const sessions = join(base, 'sessions');
  for (const dir of [proj, sessions]) mkdirSync(dir, { recursive: true });
  const usage = {
    input: 1, output: 1, cacheRead: 0, cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const make = (parentSession, text) => {
    const session = SessionManager.create(proj, sessions, parentSession ? { parentSession } : undefined);
    session.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
    session.appendMessage({
      role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: Date.now(),
      provider: 'fixture', model: 'fixture', usage, stopReason: 'stop',
    });
    return session.getSessionFile();
  };
  const main = make(undefined, 'coexistence root session');
  const childA = make(main, 'synthetic child A');
  const childB = make(main, 'synthetic child B');
  const grandchild = make(childA, 'synthetic grandchild');
  return { proj, sessions, main, childA, childB, grandchild };
}

/** Run the real CLI under the PTY driver with the given expect/send script. */
export function drivePi(args, script, env = {}, timeoutSeconds = 60, cwd = repoRoot) {
  return spawnSync(
    'uv',
    ['run', '--no-project', '--python', '3.12', 'python', driver, process.execPath, piCli, ...args],
    {
      cwd,
      env: {
        ...process.env,
        PI_OFFLINE: '1',
        PI_DRIVE_SCRIPT: JSON.stringify(script),
        PI_DRIVE_TIMEOUT: String(timeoutSeconds),
        ...loopbackGitEnv,
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (timeoutSeconds + 15) * 1000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

/**
 * Run a `pi` subcommand against a disposable profile. Offline mode is deliberately not set:
 * Pi skips git update checks when it is enabled, and these commands reach no model.
 */
export function runPi(agentDir, args, env = {}) {
  return spawnSync(process.execPath, [piCli, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...loopbackGitEnv, ...env },
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Serve this repository over git's dumb HTTP protocol. Pi rejects filesystem paths as git
 * sources, so a real transport is the only way to check git installation, and loopback
 * HTTP keeps the check offline and independent of any hosting account. The server runs in
 * its own process because the checks drive Pi with spawnSync, which blocks this event loop.
 */
export async function serveRepository(prefix, source = repoRoot) {
  const dir = workspace(prefix);
  const bare = join(dir, 'AllenYolk/pi-extensions.git');
  mkdirSync(dirname(bare), { recursive: true });
  git(dir, 'clone', '--bare', '--quiet', source, bare);
  // Serve the reviewed checkout, including detached PR merge commits, rather than its main.
  git(bare, 'update-ref', 'refs/heads/main', git(source, 'rev-parse', 'HEAD'));
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  // Dumb HTTP reads static files, so every ref change has to be republished.
  const publish = () => git(bare, 'update-server-info');
  publish();

  const python = spawnSync('uv', ['python', 'find', '3.12'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(python.status, 0, python.stderr);
  const server = spawn(
    python.stdout.trim(),
    ['-u', '-c', `
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import sys
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=sys.argv[1]))
print(server.server_port, flush=True)
server.serve_forever()
`, dir],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const lines = createInterface({ input: server.stdout });
  try {
    const [port] = await Promise.race([
      once(lines, 'line', { signal: AbortSignal.timeout(10000) }),
      once(server, 'exit').then(([code]) => { throw new Error(`the git transport exited (${code}) before listening`); }),
    ]);
    return {
      bare,
      publish,
      url: `http://127.0.0.1:${port}/AllenYolk/pi-extensions.git`,
      close: () => server.kill('SIGTERM'),
    };
  } catch (error) {
    server.kill('SIGTERM');
    throw error;
  } finally {
    lines.close();
    server.stdout.destroy();
  }
}
