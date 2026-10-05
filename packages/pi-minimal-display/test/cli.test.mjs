import { test } from 'node:test';
import { resolve } from 'node:path';
import { runCliProbe } from './run-cli.mjs';

test('the bundled Pi CLI loads, executes, groups and reloads ten times', { timeout: 30000 }, () => {
  runCliProbe(resolve('src/index.ts'), 10);
});
