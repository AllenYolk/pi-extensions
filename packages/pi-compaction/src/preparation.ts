import { buildSessionProjection, findCutPoint } from '@earendil-works/pi-coding-agent';
import type { FileOperations, SessionEntry, SessionProjection } from '@earendil-works/pi-coding-agent';
import type { SummarizationPreparation } from './summarizer.ts';

type AgentMessage = SessionProjection['messages'][number];

/**
 * Cap for each of the two file blocks `compact()` appends to the summary. The blocks are an index
 * of what a compaction covered; past a few dozen paths they are noise, and unbounded they are what
 * grew a real session's last summary to 196 lines.
 */
export const MAX_FILE_LIST_ENTRIES = 40;

/**
 * Our own preparation: the host's compaction with our cut point.
 *
 * The host's recent-token setting bounds its preparation, not its result — the hook's
 * `firstKeptEntryId` is used verbatim — so we choose the cut point ourselves and then own the
 * consequence: the range we summarise has to reach our cut point, or the entries between the
 * host's summarised range and our cut point would be dropped from the session's context without
 * ever being summarised.
 */
export function prepareCompaction(
  branchEntries: SessionEntry[],
  host: SummarizationPreparation,
  keptWindowTokens: number,
): SummarizationPreparation | undefined {
  const projected = buildSessionProjection(branchEntries).entries;
  const previousIndex = projected.findIndex((entry) => entry.sourceEntry.type === 'compaction' && entry.messages.length > 0);
  const boundaryStart = previousIndex >= 0 ? previousIndex + 1 : 0;
  // shortcut: findCutPoint() measures the raw entries, so a pruned result counts at its full size
  // and the kept window lands smaller than its target — the safe direction for base context.
  // Correcting it means reimplementing the host's cut-point search over projected sizes, which is
  // more duplication than the overshoot costs; do it if a measured kept window proves too thin.
  const sources = projected.map((entry) => entry.sourceEntry);
  const cut = findCutPoint(sources, boundaryStart, sources.length, keptWindowTokens);
  const firstKept = projected[cut.firstKeptEntryIndex]?.sourceEntry;
  if (!firstKept?.id) return undefined;

  // Everything from the previous compaction's boundary up to our cut point, in one of the two
  // ranges the host summarises. Nothing between them may fall through.
  const collect = (from: number, to: number): AgentMessage[] =>
    projected.slice(from, to).flatMap((entry) =>
      entry.sourceEntry.type === 'compaction' ? [] : entry.messages.filter((message) => message.role !== 'system'),
    );
  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptEntryIndex;
  const messagesToSummarize = collect(boundaryStart, historyEnd);
  const turnPrefixMessages = cut.isSplitTurn ? collect(cut.turnStartIndex, cut.firstKeptEntryIndex) : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

  const previous = previousIndex >= 0 ? projected[previousIndex].sourceEntry : undefined;
  return {
    firstKeptEntryId: firstKept.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore: host.tokensBefore,
    previousSummary: host.previousSummary,
    fileOps: curateFileOps(host.fileOps, previous),
    settings: host.settings,
  };
}

/**
 * Bounded file lists, and no inheritance.
 *
 * The host seeds its file operations from the previous compaction's `details` unless that
 * compaction came from a hook, which is how the lists used to compound across compactions. We drop
 * that seed ourselves so the first compaction after a native one does not carry its lists either.
 *
 * shortcut: the host extracted these from its own summarised range, which ends at its cut point
 * rather than ours, so paths touched only in the last few thousand tokens before our cut point are
 * not listed. Extract from our own range when the summary's file index proves too thin.
 */
function curateFileOps(hostOps: FileOperations, previous: SessionEntry | undefined): FileOperations {
  const inherited = previous?.type === 'compaction' && !previous.fromHook ? readDetails(previous.details) : undefined;
  const cap = (values: Set<string>, drop: string[] | undefined): Set<string> => {
    const excluded = new Set(drop ?? []);
    return new Set([...values].filter((value) => !excluded.has(value)).sort().slice(0, MAX_FILE_LIST_ENTRIES));
  };
  return {
    read: cap(hostOps.read, inherited?.readFiles),
    written: cap(hostOps.written, inherited?.modifiedFiles),
    edited: cap(hostOps.edited, inherited?.modifiedFiles),
  };
}

function readDetails(details: unknown): { readFiles?: string[]; modifiedFiles?: string[] } | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const record = details as { readFiles?: unknown; modifiedFiles?: unknown };
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);
  return { readFiles: strings(record.readFiles), modifiedFiles: strings(record.modifiedFiles) };
}
