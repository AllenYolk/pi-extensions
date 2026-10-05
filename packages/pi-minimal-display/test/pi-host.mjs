// Locate the Pi host this package actually resolves to, mirroring Node's lookup.
// A fixed `./node_modules/...` path was correct in the standalone repository, but in
// the workspace npm hoists one Pi version to the repository root and nests the other,
// and the two packages certify different versions. Walking up finds whichever copy
// this package's own imports resolve to, so the tests cannot check the wrong host.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function packageDir(name) {
  let dir = dirname(dirname(fileURLToPath(import.meta.url)));
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} is not installed above ${dir}`);
    dir = parent;
  }
}

export const piHostDir = packageDir('@earendil-works/pi-coding-agent');
export const piCli = join(piHostDir, 'dist/bundle/cli.js');

// The theme module is not exported from the host package manifest, so it is loaded by
// path. The specifier is computed, hence a dynamic import.
export const { theme } = await import(
  pathToFileURL(join(piHostDir, 'dist/modes/interactive/theme/theme.js')).href
);
