// Shared setup for the collection checks: a Pi host both packages can load, disposable
// profiles, and synthetic session trees. The host is resolved by walking up from this
// directory so the checks follow npm's actual workspace layout instead of a fixed path
// that hoisting can invalidate.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

export function workspace(prefix) {
  const work = join(repoRoot, 'work');
  mkdirSync(work, { recursive: true });
  return realpathSync(resolve(mkdtempSync(join(work, prefix))));
}

/** A disposable Pi profile. Nothing here reads or writes the real ~/.pi directory. */
export function profile(prefix, settings = {}) {
  const dir = workspace(prefix);
  // Startup help stays on: the scripts wait for the `[Extensions]` block, which is the
  // first output that proves Pi finished loading both entries.
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', showCacheMissNotices: false, ...settings }),
  );
  return dir;
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
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (timeoutSeconds + 15) * 1000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}
