import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const piHostDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
export const piCli = join(piHostDir, 'dist/bundle/cli.js');
