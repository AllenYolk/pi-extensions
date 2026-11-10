import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { piCli, packageDir, testDir } from './pi-host.mjs';
import { longSession, sandbox } from './session.mjs';

const entries = [
  '-e', resolve(testDir, 'fixtures/fake-provider.ts'),
  '-e', resolve(packageDir, 'src/index.ts'),
  '-e', resolve(testDir, 'fixtures/compaction-probe.ts'),
];
const isolation = ['--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions'];

/**
 * One real packaged-CLI run: a disposable profile, a synthetic session, the extension and the fake
 * provider loaded as the CLI loads them, and one or more compactions driven through the host's own
 * `/compact` path.
 */
export function runCompaction({
  name,
  config,
  fixture = {},
  probe = {},
  model = 'minimax-cn/pi-compaction-conversation',
  turns = 40,
  turnTokens = 1_500,
  timeoutSeconds = 120,
} = {}) {
  mkdirSync('work', { recursive: true });
  const box = sandbox(`${name}-`);
  writeFileSync(join(box.agent, 'settings.json'), JSON.stringify({ theme: 'dark', showCacheMissNotices: false }));
  if (config) {
    mkdirSync(join(box.agent, 'extensions/pi-compaction'), { recursive: true });
    writeFileSync(join(box.agent, 'extensions/pi-compaction/config.json'), JSON.stringify(config, null, 2));
  }
  const session = longSession({ cwd: box.proj, sessionDir: box.sessions, turns, turnTokens });
  const recordFile = join(box.root, 'requests.jsonl');
  const resultFile = join(box.root, 'report.json');

  const result = spawnSync(
    'uv',
    ['run', '--no-project', '--python', '3.12', 'python', resolve(testDir, 'pty.py'),
      process.execPath, piCli, ...entries, ...isolation,
      '--session', session.file, '--session-dir', box.sessions, '/compaction-probe'],
    {
      cwd: box.proj,
      env: {
        ...process.env,
        PI_OFFLINE: '1',
        PI_CODING_AGENT_DIR: box.agent,
        PI_COMPACTION_PTY_TIMEOUT: String(timeoutSeconds),
        PI_COMPACTION_FIXTURE_RECORD: recordFile,
        PI_COMPACTION_PROBE_RESULT: resultFile,
        PI_COMPACTION_PROBE_MODEL: model,
        ...Object.fromEntries(Object.entries(fixture).map(([key, value]) => [`PI_COMPACTION_FIXTURE_${key}`, String(value)])),
        ...Object.fromEntries(Object.entries(probe).map(([key, value]) => [`PI_COMPACTION_PROBE_${key}`, String(value)])),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (timeoutSeconds + 30) * 1000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.doesNotMatch(result.stdout ?? '', /PI_COMPACTION_PTY_TIMEOUT/, 'the CLI run did not finish in time');

  const records = readRecords(recordFile);
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  return { box, session, report, records, stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

export function readRecords(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export const summarizationRecords = (records) => records.filter((record) => record.summarization);

/** The compaction entries the host persisted, read back from the session file on disk. */
export function persistedCompactions(sessionFile) {
  return readFileSync(sessionFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'compaction');
}
