// Shared setup for the collection checks: a Pi host both packages can load, disposable
// profiles, synthetic session trees, and a loopback git transport. The host is resolved by
// walking up from this directory so the checks follow npm's actual workspace layout
// instead of a fixed path that hoisting can invalidate.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const testDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = dirname(testDir);

function packageDir(name) {
  let dir = testDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} is not installed above ${testDir}`);
    dir = parent;
  }
}

export const piHostDir = packageDir('@earendil-works/pi-coding-agent');
export const piCli = join(piHostDir, 'dist/bundle/cli.js');
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

export function writeSettings(agentDir, settings) {
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings, null, 2));
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
export async function serveRepository(prefix) {
  const dir = workspace(prefix);
  const bare = join(dir, 'AllenYolk/pi-extensions.git');
  mkdirSync(dirname(bare), { recursive: true });
  git(dir, 'clone', '--bare', '--quiet', repoRoot, bare);
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  // Dumb HTTP reads static files, so every ref change has to be republished.
  const publish = () => git(bare, 'update-server-info');
  publish();

  const port = await freePort();
  const server = spawn(
    'uv',
    ['run', '--no-project', '--python', '3.12', 'python', '-m', 'http.server',
     String(port), '--bind', '127.0.0.1', '--directory', dir],
    { stdio: 'ignore', detached: false },
  );
  server.unref();
  await waitForPort(port);

  return {
    bare,
    publish,
    url: `http://127.0.0.1:${port}/AllenYolk/pi-extensions.git`,
    close: () => server.kill('SIGKILL'),
  };
}

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(done => probe.close(done));
  return port;
}

async function waitForPort(port, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reachable = await new Promise(done => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); done(true); });
      socket.once('error', () => done(false));
    });
    if (reachable) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`the git transport never came up on port ${port}`);
}
