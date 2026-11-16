/**
 * The fixed input every arm is measured on: a committed synthetic session, cut once, at the token
 * target the fixture declares.
 *
 * Nothing here reaches the network or reads credentials — it is session-file parsing and the host's
 * own projection, which is why `--score` can run offline.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSessionProjection,
  convertToLlm,
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
  parseSessionEntries,
  serializeConversation,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { prepareCompaction } from '../src/preparation.ts';
import type { SummarizationPreparation } from '../src/summarizer.ts';
import { probeMatches, type Probe } from './score.ts';

/** The fixture this package ships and measures against. */
export const DEFAULT_FIXTURE = fileURLToPath(new URL('./fixtures/long-session.json', import.meta.url));

/** The fixture manifest, as written. Paths in it are relative to the manifest. */
interface Manifest {
  session: string;
  previousSummary?: string;
  keptWindowTokens?: number;
  probes: Probe[];
}

export interface Fixture {
  manifestPath: string;
  sessionPath: string;
  previousSummaryPath: string | undefined;
  keptWindowTokens: number;
  /** The declared probes the summarised range actually contains. */
  probes: Probe[];
  /** Declared probes the range does not contain. Only ever non-empty for an operator's own session. */
  dropped: string[];
  previousSummary: string;
  /** The summarised messages, serialized the way the host serializes them for the summarizer. */
  sessionText: string;
  /** Everything the summarizer is given: the summarised range plus the previous summary. */
  range: string;
  prepared: SummarizationPreparation;
}

/**
 * Read a fixture and cut its session once.
 *
 * Every probe is checked against the range before anything is measured. A probe the input does not
 * contain is an unwinnable test — no summarizer can keep it — so for the fixture's own session it is
 * an error rather than a score of zero.
 */
export function loadFixture(manifestPath: string, sessionOverride?: string): Fixture {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const base = dirname(manifestPath);
  const resolve = (path: string) => (isAbsolute(path) ? path : join(base, path));
  const sessionPath = sessionOverride ? resolve(sessionOverride) : resolve(manifest.session);
  const previousSummaryPath = manifest.previousSummary ? resolve(manifest.previousSummary) : undefined;
  const previousSummary = previousSummaryPath ? readFileSync(previousSummaryPath, 'utf8') : '';
  const keptWindowTokens = manifest.keptWindowTokens ?? 16_000;
  const probes = manifest.probes.map(checkProbe);

  const entries = parseSessionEntries(readFileSync(sessionPath, 'utf8'))
    .filter((entry): entry is SessionEntry => entry.type !== 'session');
  if (entries.length === 0) throw new Error(`${sessionPath} contains no session entries`);

  const projection = buildSessionProjection(entries);
  const host: SummarizationPreparation = {
    firstKeptEntryId: entries[entries.length - 1]!.id,
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: projection.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
    previousSummary,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: DEFAULT_COMPACTION_SETTINGS,
  };
  const prepared = prepareCompaction(entries, host, keptWindowTokens);
  if (!prepared) {
    throw new Error(
      `a kept window of ${keptWindowTokens} tokens leaves nothing to summarise in ${sessionPath}; `
      + 'lower keptWindowTokens or use a longer session',
    );
  }

  const sessionText = serializeConversation(convertToLlm(
    [...prepared.messagesToSummarize, ...prepared.turnPrefixMessages],
  ));
  const range = `${sessionText}\n${previousSummary}`;
  const dropped = probes.filter((probe) => !probeMatches(probe, range)).map((probe) => probe.id);
  // The committed fixture has to be self-consistent. An operator's own session is measured on
  // whatever it happens to contain, so probes it lacks are reported rather than refused.
  if (dropped.length > 0 && !sessionOverride) {
    throw new Error(`probes that do not occur in ${sessionPath}: ${dropped.join(', ')}`);
  }

  return {
    manifestPath, sessionPath, previousSummaryPath, keptWindowTokens,
    probes: probes.filter((probe) => !dropped.includes(probe.id)),
    dropped, previousSummary, sessionText, range, prepared,
  };
}

function checkProbe(probe: Probe): Probe {
  const where = `probe ${probe?.id ?? '<unnamed>'}`;
  if (probe?.kind !== 'literal' && probe?.kind !== 'regex') {
    throw new Error(`${where} must be a literal or a regex`);
  }
  if (typeof probe.value !== 'string' || probe.value.length === 0) {
    throw new Error(`${where} has no value`);
  }
  if (probe.kind === 'regex') {
    try {
      new RegExp(probe.value);
    } catch (error) {
      throw new Error(`${where} is not a usable regex: ${String(error)}`);
    }
  }
  return probe;
}
