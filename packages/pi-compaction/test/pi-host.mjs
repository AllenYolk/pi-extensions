import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const piHostDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
export const piCli = join(piHostDir, 'dist/bundle/cli.js');
export const testDir = dirname(fileURLToPath(import.meta.url));
export const packageDir = dirname(testDir);
