import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const piHostDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
export const piCli = join(piHostDir, 'dist/bundle/cli.js');

// The theme module is not exported from the host package manifest, so it is loaded by
// path. The specifier is computed, hence a dynamic import.
export const { theme } = await import(
  pathToFileURL(join(piHostDir, 'dist/modes/interactive/theme/theme.js')).href
);
