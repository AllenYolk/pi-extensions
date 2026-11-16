import { estimateTokens } from '@earendil-works/pi-coding-agent';
import type { Redistill } from './config.ts';

/**
 * Re-distillation: asking the summarizer to merge the previous summary towards a fixed point instead
 * of only adding to it.
 *
 * The host's update prompt makes every compaction a union of the previous summary, so the summary is
 * the one thing in a session that only ever grows. The single lever an extension has that does not
 * damage the current response is `compact()`'s `customInstructions`, which the host appends to its
 * own prompt as an `Additional focus:` line — on the main summary and on a split turn's turn prefix
 * alike, which is why one value covers both requests.
 *
 * This asks. It enforces nothing: no output ceiling is sent, nothing is truncated, and a model that
 * ignores the instruction produces exactly the summary it produces today. [ADR 0006](../docs/adr/0006-ask-for-a-fixed-point.md)
 * records why that is not the ceiling [ADR 0005](../docs/adr/0005-bound-by-not-bounding.md) removed.
 *
 * The wording is fixed here rather than configured: a template is testable, and a free-text prompt
 * field would be a second prompt to maintain. The only variable parts are the two numbers.
 */
const TEMPLATE = (previousTokens: number, targetTokens: number) =>
  `The previous summary is ${previousTokens} tokens and the merged summary should stay under ${targetTokens}. `
  + 'Keep every goal, constraint, decision with its rationale, blocker, open question and next step '
  + 'that is still true. Drop an entry when a later entry supersedes it, and drop detail about work '
  + 'that is finished and no longer referenced. Do not append a changelog and do not add a history section.';

/** The previous summary's size, in the host's own estimate for a summary. */
export function previousSummaryTokens(previousSummary: string): number {
  return estimateTokens({ role: 'compactionSummary', summary: previousSummary, tokensBefore: 0, timestamp: 0 });
}

/**
 * What `compact()`'s `customInstructions` argument should carry for this compaction.
 *
 * The caller's own instructions — `/compact <text>` — are returned unchanged whenever nothing is
 * asked for, and are never modified when something is: ours is appended to theirs. Off, a first
 * compaction and a previous summary below the threshold all return the caller's value untouched.
 */
export function redistillInstructions(
  previousSummary: string | undefined,
  redistill: Redistill | null,
  customInstructions: string | undefined,
): string | undefined {
  if (!redistill || !previousSummary) return customInstructions;
  const previousTokens = previousSummaryTokens(previousSummary);
  if (previousTokens < redistill.aboveTokens) return customInstructions;
  const ours = TEMPLATE(previousTokens, redistill.targetTokens);
  return customInstructions ? `${customInstructions}\n\n${ours}` : ours;
}
