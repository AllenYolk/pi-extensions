import type { Selection } from './config.ts';
import type { AttemptOutcome } from './summarizer.ts';

/**
 * The announcement that ends a compaction, and the words it uses.
 *
 * A compaction this package could not complete hands back to stock Pi. That is the owner's explicit
 * choice — availability over size, with a loud warning — so the announcement names the preset, the
 * reason and what the session's behaviour now is, rather than printing a line and hoping.
 */

/** The custom session entry a degradation is recorded as. Custom entries carry no LLM context. */
export const DEGRADATION_ENTRY = 'pi-compaction-degradation';

/** The widget the announcement is pinned under, so a later compaction can take it down. */
export const DEGRADATION_WIDGET = 'pi-compaction-degradation';

/** Why the attempt failed, in the package's own words rather than the host's. */
export function describeFailure(outcome: AttemptOutcome | undefined, error: unknown): string {
  if (outcome?.toolCall) return 'the summarizer tried to call a tool instead of writing a summary';
  if (outcome?.stopReason === 'error') return `the summarizer reported an error (${messageOf(error)})`;
  if (outcome) return `the summarizer's response stopped with "${outcome.stopReason}" instead of finishing, so the summary may be partial`;
  return `the summarizer did not produce a summary (${messageOf(error)})`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Why an attempt whose responses were never observed is refused. Distinct from `describeFailure`'s
 * unobserved case, which has a thrown error to quote: here `compact()` handed back a summary and this
 * package never saw the responses that produced it, so it has proved nothing about it.
 */
export const UNOBSERVED_RESPONSE =
  "the summarizer's responses were never observed, so the package cannot prove the summary is complete";

export interface Degradation {
  preset: Selection;
  /** What the preset asked to summarise with, or what there was instead. */
  summarizer: string;
  /** Why the attempt failed. */
  reason: string;
}

/**
 * What stock Pi costs once this package steps aside. Measured on the profile this package was built
 * against — one real session, sixteen compactions — because there is nothing to derive it from: the
 * host sends no output ceiling at all, so the number is whatever the summarizer model felt like
 * writing.
 */
const STOCK_PI_COST =
  'stock Pi sends no output ceiling at all, so the summary is bounded only by the summarizer '
  + "model's own output limit. Measured on the profile this package was built against, summaries "
  + 'grew 3,437 to 26,019 tokens across 16 compactions, each taking 289 to 490 seconds, and base '
  + 'context grew with them.';

/**
 * The announcement, as the lines the user reads. Line one is the headline; the rest name the
 * preset, the reason, what the session's behaviour now is and what that costs.
 */
export function announcement(degradation: Degradation): string[] {
  return [
    'degraded — compaction handed back to stock Pi',
    `Preset: ${degradation.preset} — summarizer ${degradation.summarizer}`,
    `Why: ${degradation.reason}`,
    `Now: ${STOCK_PI_COST}`,
    'Next: /compaction preset fast for a hard 6,000-token ceiling, /compaction model provider/model '
      + 'for a summarizer on an answer-budget API, or /compaction disable to make this the default.',
  ];
}
