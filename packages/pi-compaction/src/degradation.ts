import type { AttemptOutcome } from './summarizer.ts';

/**
 * The announcement that ends a compaction, and the words it uses.
 *
 * A compaction this package could not complete hands back to stock Pi. That is the owner's explicit
 * choice — availability over control, with a loud warning — so the announcement names the summarizer,
 * the reason and what the session's behaviour now is, rather than printing a line and hoping.
 */

/** The custom session entry a degradation is recorded as. Custom entries carry no LLM context. */
export const DEGRADATION_ENTRY = 'pi-compaction-degradation';

/** The widget the announcement is pinned under, so a later compaction can take it down. */
export const DEGRADATION_WIDGET = 'pi-compaction-degradation';

/** Why the attempt failed, in the package's own words rather than the host's. */
export function describeFailure(outcome: AttemptOutcome | undefined, error: unknown): string {
  if (outcome?.toolCall) return 'the summarizer tried to call a tool instead of writing a summary';
  const reason = outcome?.stopReason;
  if (reason === 'error') return `the summarizer reported an error (${quote(messageOf(error))})`;
  if (reason) {
    return `the summarizer's response stopped with "${quote(reason)}" instead of finishing, `
      + 'so the summary may be partial';
  }
  // No stop reason this package recognises: either the provider sent none, or it sent something not
  // modelled here. A thrown error is then the only diagnostic there is, and quoting it beats printing
  // the string "undefined" at the user.
  if (error !== undefined) return `the summarizer did not produce a summary (${quote(messageOf(error))})`;
  return outcome
    ? "the summarizer's response carried no stop reason, so the package cannot prove it finished"
    : 'the summarizer did not produce a summary';
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Provider-originated text, reduced to what it is being quoted for.
 *
 * An error message reaches the announcement, which is written to the terminal and pinned as a widget.
 * Control characters there can rewrite the display, a newline breaks the one-fact-per-line shape the
 * announcement depends on, and an unbounded message would push the rest of it off the screen.
 */
function quote(text: string): string {
  const flattened = text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flattened.length > 300 ? `${flattened.slice(0, 300)}…` : flattened;
}

/**
 * Why an attempt whose responses were never observed is refused. Distinct from `describeFailure`'s
 * unobserved case, which has a thrown error to quote: here `compact()` handed back a summary and this
 * package never saw the responses that produced it, so it has proved nothing about it.
 */
export const UNOBSERVED_RESPONSE =
  "the summarizer's responses were never observed, so the package cannot prove the summary is complete";

export interface Degradation {
  /** What the compaction was to summarise with, or what there was instead. */
  summarizer: string;
  /** Why the attempt failed. */
  reason: string;
}

/**
 * What a handback costs. It is not a change in summary length: this package sends no output ceiling
 * and neither does stock Pi, so both produce a summary as long as the host's prompt and the model
 * make it. What a handback gives up is the three things this package controls — the model, the
 * thinking level, and the cut point.
 */
const HANDBACK_COST =
  'stock Pi compacts with the conversation model, the session\'s own thinking level, and the host\'s '
  + 'recent-token setting rather than this package\'s kept-window target. The summary length is '
  + 'unaffected — neither path sends an output ceiling — but those three are the whole of what this '
  + 'package controls, so a handback gives all of them up.';

/**
 * The announcement, as the lines the user reads. Line one is the headline; the rest name the
 * summarizer, the reason, what the session's behaviour now is and what to do about it.
 */
export function announcement(degradation: Degradation): string[] {
  return [
    'degraded — compaction handed back to stock Pi',
    `Summarizer: ${degradation.summarizer}`,
    `Why: ${degradation.reason}`,
    `Now: ${HANDBACK_COST}`,
    'Next: /compaction model provider/model to summarise with a different model, /compaction '
      + 'thinking off|minimal|low|medium|high|xhigh|max to change how hard it thinks, /compaction '
      + 'window <tokens> to change the cut point, or /compaction disable to make stock Pi the default.',
  ];
}
