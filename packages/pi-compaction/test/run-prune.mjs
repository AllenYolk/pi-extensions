import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { compactionEntry, compactionFixtures, driveHost, longSession, profile, workspace } from '../../../test/pi-collection.mjs';
import { piCli } from './pi-host.mjs';
import { plainText, readRecords } from './run-compaction.mjs';

const entries = [
  '-e', resolve(compactionFixtures, 'fake-provider.ts'),
  '-e', compactionEntry,
  '-e', resolve(compactionFixtures, 'prune-probe.ts'),
];
const isolation = ['--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions'];

/** The marker the probe writes on every session start, including after a reload. */
export const READY = 'PI_COMPACTION_PRUNE_READY';

/**
 * One real packaged-CLI run for the prune path: a disposable profile, a synthetic session whose
 * every tool call has a result, the extension and the fake provider loaded the way the CLI loads
 * them, and real turns driven through the host so a prune runs at a turn boundary. No model and no
 * network are involved: pruning is session-entry manipulation.
 *
 * The session file is read before and after, because a prune must leave every raw entry on disk
 * byte for byte.
 */
export function runPrune({
  name,
  config,
  fixture = {},
  probe = {},
  model = 'minimax-cn/pi-compaction-conversation',
  turns = 8,
  turnTokens = 1_200,
  messages = 2,
  script,
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
  const session = longSession(SessionManager, { cwd: proj, sessionDir: sessions, turns, turnTokens, completeResults: true });
  const before = readFileSync(session.file, 'utf8');
  const recordFile = join(box, 'requests.jsonl');
  const resultFile = join(box, 'report.json');

  const result = driveHost(
    piCli,
    [...entries, ...isolation, '--session', session.file, '--session-dir', sessions,
      ...(script ? [] : ['/prune-probe'])],
    script ?? [],
    {
      PI_CODING_AGENT_DIR: agent,
      PI_COMPACTION_FIXTURE_RECORD: recordFile,
      PI_COMPACTION_PRUNE_RESULT: resultFile,
      PI_COMPACTION_PRUNE_MODEL: model,
      PI_COMPACTION_PRUNE_MESSAGES: String(messages),
      ...Object.fromEntries(Object.entries(fixture).map(([key, value]) => [`PI_COMPACTION_FIXTURE_${key}`, String(value)])),
      ...Object.fromEntries(Object.entries(probe).map(([key, value]) => [`PI_COMPACTION_PRUNE_${key}`, String(value)])),
    },
    timeoutSeconds,
    proj,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.doesNotMatch(result.stdout ?? '', /PI_DRIVE_TIMEOUT/, 'the CLI run did not finish in time');
  assert.doesNotMatch(result.stderr ?? '', /PI_DRIVE_UNMATCHED/, result.stderr);

  return {
    box, agent, session, before,
    after: readFileSync(session.file, 'utf8'),
    report: JSON.parse(readFileSync(resultFile, 'utf8')),
    records: readRecords(recordFile),
    status: result.status,
    stdout: result.stdout ?? '',
    plain: plainText(result.stdout ?? ''),
  };
}

/** Every line of the session file, parsed. */
export const fileEntries = (text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line));

/** The context edits the host persisted, in file order. */
export const contextEdits = (text) => fileEntries(text).filter((entry) => entry.type === 'context_edit');

/** The requests the fake provider answered, oldest first. */
export const requests = (records) => records.filter((record) => !record.summarization);

/** The raw tool-result entry whose text begins with one fixture marker. */
export const resultEntryFor = (text, marker) =>
  fileEntries(text).find((entry) =>
    entry.type === 'message'
    && entry.message.role === 'toolResult'
    && typeof entry.message.content?.[0]?.text === 'string'
    && entry.message.content[0].text.startsWith(`${marker} `));

/** The raw tool-result entries for one tool name, in file order. */
export const resultsFor = (text, toolName) =>
  fileEntries(text).filter((entry) =>
    entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === toolName);
