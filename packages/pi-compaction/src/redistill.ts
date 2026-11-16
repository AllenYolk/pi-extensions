import { estimateTokens } from '@earendil-works/pi-coding-agent';
import type { Redistill } from './config.ts';
import type { SeamResult } from './summarizer.ts';

/**
 * Re-distillation: asking the summarizer to merge the previous summary towards a fixed point instead
 * of only adding to it.
 *
 * The host's update prompt makes every compaction a union of the previous summary, so the summary is
 * the one thing in a session that only ever grows. The single lever an extension has that does not
 * damage the current response is `compact()`'s `customInstructions`, which the host appends to its
 * own prompt as an `Additional focus:` line.
 *
 * That value reaches **both** of a split turn's summarization requests, and the second one's document
 * is only the current turn's prefix: no previous summary, and its output is concatenated onto the
 * merged summary rather than being one. The instruction's premise would be false there and its
 * pruning clause would aim at the newest range — the one loss this package otherwise refuses to risk —
 * so a split turn is left alone. Per-request wording would mean rewriting the prompt inside our own
 * stream function, which is a seam this package does not take.
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
  return estimateTokens(summaryMessage(previousSummary));
}

/** The message shape whose size this package asks the host for. */
const summaryMessage = (summary: string) =>
  ({ role: 'compactionSummary', summary, tokensBefore: 0, timestamp: 0 }) as const;

/**
 * The fourth host seam: that `estimateTokens()` accepts a `compactionSummary` message and returns its
 * size. The other three are `compact()`'s, and `checkHostSeam` probes them; this one is probed here
 * because it belongs to this module, and because its consequence is different — a mismatch turns
 * redistilling off rather than handing compaction back.
 *
 * Without it, a host that stopped recognising the shape would return 0 or NaN, every summary would
 * then be "below" `aboveTokens`, and redistilling would turn itself on for every compaction while the
 * instruction named a wrong number: silently the opposite of inert.
 */
export function checkTokenSeam(estimate: typeof estimateTokens = estimateTokens): SeamResult {
  const of = (chars: number) => estimate(summaryMessage('x'.repeat(chars)));
  try {
    const small = of(56);
    const large = of(5_600);
    if (!Number.isFinite(small) || !Number.isFinite(large)) {
      return {
        ok: false,
        detail: `estimateTokens() returned ${small} and ${large} for a compactionSummary message, which is not a size`,
      };
    }
    if (small <= 0) {
      return { ok: false, detail: `estimateTokens() returned ${small} for a 56-character summary` };
    }
    if (large <= small) {
      return {
        ok: false,
        detail: `estimateTokens() is not monotone in a summary's length (${small} then ${large} tokens `
          + 'for 56 and 5,600 characters)',
      };
    }
    return {
      ok: true,
      detail: 'estimateTokens() sized a compactionSummary message '
        + `(${small} then ${large} tokens for 56 and 5,600 characters)`,
    };
  } catch (error) {
    return { ok: false, detail: `estimateTokens() rejected a compactionSummary message: ${String(error)}` };
  }
}

/**
 * The thresholds a compaction may use: none when this host's token estimate did not check out. The
 * caller's own `/compact <text>` is unaffected either way — only this package's asking is.
 */
export function redistillFor(redistill: Redistill | null, seam: SeamResult): Redistill | null {
  return seam.ok ? redistill : null;
}

/** The `/compaction` line: what is asked for, and — when the host cannot be trusted for it — why not. */
export function redistillStatus(redistill: Redistill | null, seam: SeamResult): string {
  if (!seam.ok) {
    return `Redistilling: off — this host's token estimate did not check out, so nothing is asked for (${seam.detail})`;
  }
  return redistill
    ? `Redistilling: on — asks for a fixed point once the previous summary reaches ${redistill.aboveTokens} `
      + `tokens, naming ${redistill.targetTokens} as the target (a request, not a ceiling)`
    : 'Redistilling: off';
}

/**
 * What `compact()`'s `customInstructions` argument should carry for this compaction.
 *
 * The caller's own instructions — `/compact <text>` — are returned unchanged whenever nothing is
 * asked for, and are never modified when something is: ours is appended to theirs. Off, a first
 * compaction, a previous summary below the threshold and a split turn all return the caller's value
 * untouched.
 */
export function redistillInstructions(
  previousSummary: string | undefined,
  redistill: Redistill | null,
  customInstructions: string | undefined,
  /** The host applies one value to both of a split turn's requests; see the note above. */
  isSplitTurn: boolean,
): string | undefined {
  if (!redistill || !previousSummary || isSplitTurn) return customInstructions;
  const previousTokens = previousSummaryTokens(previousSummary);
  if (previousTokens < redistill.aboveTokens) return customInstructions;
  const ours = TEMPLATE(previousTokens, redistill.targetTokens);
  return customInstructions ? `${customInstructions}\n\n${ours}` : ours;
}
