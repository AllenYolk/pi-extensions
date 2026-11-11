import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every sandbox this process built, removed when the process ends.
 *
 * A sandbox that outlives its test leaves a Pi profile — `auth.json`, `models-store.json`, a session
 * tree — on the developer's disk, so teardown cannot depend on each caller remembering to clean up
 * after itself.
 */
const live = new Set();

const sweep = () => {
  for (const dir of live) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // A sandbox a test made unwritable is still a leak; name it rather than fail the run.
      console.error(`test sandbox left behind: ${dir} (${error.code})`);
    }
  }
  live.clear();
};

let hooked = false;
const hook = () => {
  if (hooked) return;
  hooked = true;
  process.on('exit', sweep);
  // `node --test` kills a file that exceeds its timeout with SIGTERM, which skips `exit`.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      sweep();
      process.exit(1);
    });
  }
};

/**
 * A disposable directory, removed when this process ends — after a passing run, after a thrown
 * assertion, and after the SIGTERM the test runner sends on timeout.
 *
 * `base` defaults to the current package's `work/` directory; the repository-root collection passes
 * its own.
 *
 * shortcut: a SIGKILL, or a crash inside the sweep, still leaks. Nothing in this suite sends either;
 * if one appears, sweep `work/` on a schedule instead.
 */
export function sandbox(prefix, base = 'work') {
  mkdirSync(base, { recursive: true });
  const dir = realpathSync(resolve(mkdtempSync(join(base, prefix))));
  live.add(dir);
  hook();
  return dir;
}
