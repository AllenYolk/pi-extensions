import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { compactionEntry, compactionFixtures, driveHost, longSession, profile, workspace } from '../../../test/pi-collection.mjs';
import { piCli } from './pi-host.mjs';

const entries = [
  '-e', resolve(compactionFixtures, 'fake-provider.ts'),
  '-e', compactionEntry,
  '-e', resolve(compactionFixtures, 'compaction-probe.ts'),
];
const isolation = ['--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions'];

/** The marker the probe writes on every session start, including after a reload. */
export const READY = 'PI_COMPACTION_PROBE_READY';
/** The marker the probe writes once its report is on disk and the CLI is still running. */
export const DONE = 'PI_COMPACTION_PROBE_DONE';

/**
 * A script that runs the probe, then renders the status view against the run that just happened, so
 * a caller can read what the extension itself reports about it. Ctrl-D leaves the CLI on a settled
 * frame, on a settled screen.
 */
export const statusScript = [
  { expect: READY, send: '/compaction-probe\r' },
  { expect: DONE, send: '/compaction\r' },
  { expect: 'Host seam:', send: '\u0004' },
];

/**
 * One real packaged-CLI run: a disposable profile, a synthetic session, the extension and the fake
 * provider loaded the way the CLI loads them, and one or more compactions driven through the host's
 * own compaction path.
 *
 * The host is this package's own — the repository root resolves a different copy after hoisting —
 * so the shared PTY driver is pointed at this package's CLI.
 */
export function runCompaction({
  name,
  config,
  fixture = {},
  probe = {},
  model = 'minimax-cn/pi-compaction-conversation',
  turns = 40,
  turnTokens = 1_500,
  script,
  hold = false,
  timeoutSeconds = 120,
} = {}) {
  const box = workspace(`${name}-`);
  const agent = profile(`${name}-agent-`);
  const proj = join(box, 'proj');
  const sessions = join(box, 'sessions');
  if (config) {
    const dir = join(agent, 'extensions/pi-compaction');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  const session = longSession(SessionManager, { cwd: proj, sessionDir: sessions, turns, turnTokens });
  const recordFile = join(box, 'requests.jsonl');
  const resultFile = join(box, 'report.json');

  const result = driveHost(
    piCli,
    [...entries, ...isolation, '--session', session.file, '--session-dir', sessions,
      ...(script ? [] : ['/compaction-probe'])],
    script ?? [],
    {
      PI_CODING_AGENT_DIR: agent,
      PI_COMPACTION_FIXTURE_RECORD: recordFile,
      PI_COMPACTION_PROBE_RESULT: resultFile,
      PI_COMPACTION_PROBE_MODEL: model,
      ...(hold ? { PI_COMPACTION_PROBE_HOLD: '1' } : {}),
      ...Object.fromEntries(Object.entries(fixture).map(([key, value]) => [`PI_COMPACTION_FIXTURE_${key}`, String(value)])),
      ...Object.fromEntries(Object.entries(probe).map(([key, value]) => [`PI_COMPACTION_PROBE_${key}`, String(value)])),
    },
    timeoutSeconds,
    proj,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.doesNotMatch(result.stdout ?? '', /PI_DRIVE_TIMEOUT/, 'the CLI run did not finish in time');
  assert.doesNotMatch(result.stderr ?? '', /PI_DRIVE_UNMATCHED/, result.stderr);

  const records = readRecords(recordFile);
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  return {
    box, agent, session, report, records, status: result.status,
    stdout: result.stdout ?? '', plain: plainText(result.stdout ?? ''),
  };
}

export function readRecords(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Terminal output with its escapes removed and its wrapping collapsed, for message assertions. */
export function plainText(output) {
  return output
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[[\]()#;?]*[0-9;]*[A-Za-z]/g, '')
    .replace(/\s+/g, ' ');
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
