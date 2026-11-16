import type { ThinkingLevel } from './config.ts';
import type { AttemptOutcome } from './summarizer.ts';

/**
 * The announcement that ends a compaction, and the words it uses.
 *
 * A compaction this package could not complete hands back to stock Pi. That is the owner's explicit
 * choice — availability over control, with a loud warning — so the announcement names the summarizer,
 * the reason and what the session's behaviour now is, rather than printing a line and hoping.
 */

/** The custom session entry a handback is recorded as. Custom entries carry no LLM context. */
export const DEGRADATION_ENTRY = 'pi-compaction-degradation';

/**
 * The custom session entry a *successful* fallback is recorded as.
 *
 * A distinct entry type rather than a flag inside the degradation one: the type is what anything
 * scanning the session reads, and a fallback that produced the summary is not a degradation.
 */
export const FALLBACK_ENTRY = 'pi-compaction-fallback';

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

export interface Attempt {
  /** What the attempt was to summarise with, or what there was instead. */
  summarizer: string;
  /** Why it failed. Absent on the attempt that produced the summary. */
  reason?: string;
  /**
   * The thinking level this attempt actually ran at, and the level that was asked for when they
   * differ. Absent on an attempt that never made a request, and on a record written before the
   * level was carried.
   *
   * The level is clamped **per model**, so it is a property of the attempt rather than of the
   * compaction: the same configured level gives two models two different answers.
   */
  thinking?: { level: ThinkingLevel; clampedFrom?: ThinkingLevel };
}

/**
 * What a compaction did when the summarizer it was configured with did not produce the summary.
 *
 * One shape covers both outcomes, and the last attempt carries the difference: it ran unless it has
 * a reason, so a handback and a successful fallback are told apart by the record itself rather than
 * by a flag kept beside it.
 */
export interface CompactionRecord {
  /** Every attempt the compaction made, in the order it made them. */
  attempts: Attempt[];
}

/**
 * Whether the compaction ended in a handback rather than a summary this package produced.
 *
 * A record with no attempt in it is not a handback — nothing in it failed — so the answer is `false`.
 * The renderers below say so in words rather than letting this predicate decide a headline for them.
 */
export const handedBack = (record: CompactionRecord): boolean => {
  const last = record.attempts[record.attempts.length - 1];
  return last !== undefined && last.reason !== undefined;
};

/**
 * A record as it was written, whichever version wrote it.
 *
 * `0.2.1` recorded a single attempt as `{ summarizer, reason }`. A session outlives the version that
 * compacted it, and the custom entry is the half of the announcement that survives a restart — so
 * that shape is normalised into the current one rather than skipped. Not crashing on it is not the
 * bar; a handback that was recorded stays readable.
 *
 * Anything that is neither shape is not a record, and is left alone rather than invented into one.
 */
export function toRecord(data: unknown): CompactionRecord | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const written = data as { attempts?: unknown; summarizer?: unknown; reason?: unknown };
  if (Array.isArray(written.attempts)) {
    return written.attempts.length > 0 ? { attempts: written.attempts as Attempt[] } : undefined;
  }
  if (typeof written.summarizer === 'string' && typeof written.reason === 'string') {
    return { attempts: [{ summarizer: written.summarizer, reason: written.reason }] };
  }
  return undefined;
}

/**
 * What a handback costs, as one sentence about the model, the thinking level and the cut point — named
 * rather than counted, because redistilling is a fourth thing a handback can give up and a total of
 * three here would contradict the line below.
 *
 * Without redistilling this is not a change in summary length: this package sends no output ceiling and
 * neither does stock Pi, so both produce a summary as long as the host's prompt and the model make it.
 * With redistilling that claim is no longer true, and saying it anyway would make the announcement lie
 * in exactly the case the extra clause describes: the request that named a target size is gone, so the
 * merged summary is a union again and nothing asks for a size. The ceiling claim survives either way —
 * neither path sends one.
 */
/**
 * What a handback costs, unchanged from the released wording when redistilling is off.
 *
 * Without redistilling this is not a change in summary length: this package sends no output ceiling and
 * neither does stock Pi, so both produce a summary as long as the host's prompt and the model make it.
 * The sentence is reproduced byte for byte because it is user-visible on every handback, and only the
 * redistilling case is allowed to differ.
 */
const HANDBACK_COST =
  'stock Pi compacts with the conversation model, the session\'s own thinking level, and the host\'s '
  + 'recent-token setting rather than this package\'s kept-window target. The summary length is '
  + 'unaffected — neither path sends an output ceiling — but those three are the whole of what this '
  + 'package controls, so a handback gives all of them up.';

/**
 * What a handback costs when redistilling was in force, which is not the sentence above.
 *
 * Two claims in it stop being true the moment a fixed-point request is being made. The summary's length
 * *is* affected: the request that named a target size is gone, so the merged summary is a union again
 * and nothing asks for a size. And those three are not the whole of what this package controls —
 * redistilling is a fourth, and the host applies only the caller's own `/compact <text>` on its own
 * path, so a handback stops asking for it. The ceiling claim survives: neither path sends one.
 */
const REDISTILL_HANDBACK_COST =
  'stock Pi compacts with the conversation model, the session\'s own thinking level, and the host\'s '
  + 'recent-token setting rather than this package\'s kept-window target. Neither path sends an output '
  + 'ceiling, but a redistilling instruction was configured and stock Pi does not ask for it, so the '
  + 'summary is a union again and nothing requests a size. A handback gives up the model, the thinking '
  + 'level, the cut point and that instruction.';
/**
 * What a fallback costs. The cut point and the whole-summary guarantee are unchanged, but the
 * thinking level is clamped per model — so a fallback that cannot honour the configured level runs
 * at a different one, and the level it did run at is named rather than assumed. This is the rule
 * `/compaction` already follows for the summarizer: report the level that ran, not the one asked for.
 */
function fallbackCost(thinking: Attempt['thinking']): string {
  const level = thinking === undefined
    ? ''
    : ` and at thinking level ${thinking.level}`
      + (thinking.clampedFrom === undefined
        ? ''
        : ` (clamped from ${thinking.clampedFrom}; the level is clamped per model)`);
  return 'the summarizer configured here did not run. This summary is the fallback\'s, over the same '
    + `kept window${level}, so the cut point and the whole-summary guarantee are unchanged — but the `
    + 'model you chose is not the one that wrote it.';
}

const NEXT =
  'Next: /compaction fallback provider/model to try a second summarizer before the host takes over, '
  + '/compaction model provider/model to summarise with a different model, /compaction '
  + 'thinking off|minimal|low|medium|high|xhigh|max to change how hard it thinks, /compaction '
  + 'window <tokens> to change the cut point, or /compaction disable to make stock Pi the default.';

/**
 * What an unreadable record says.
 *
 * A hand-edited or truncated entry can carry no attempt at all, and then neither the model that ran
 * nor the reason one failed can be read from it. This surface is the one that must never crash —
 * `/compaction`'s status view and the handback announcement, read by whoever is already trying to
 * find out what went wrong — so it says what it does not know instead of guessing a headline.
 */
const NO_ATTEMPTS = [
  'unreadable — the compaction record carries no attempt',
  'Summarizer: none recorded',
  'Why: the record names no attempt, so neither the model that ran nor the reason one failed can be read from it',
  'Now: unknown — this record cannot say whether the package summarised or handed back.',
  NEXT,
];

/** The `Now:` line for a handback: the released sentence, or the redistilling one. */
const handBackCost = (redistilling: boolean): string =>
  (redistilling ? REDISTILL_HANDBACK_COST : HANDBACK_COST);

/**
 * The announcement, as the lines the user reads. Line one is the headline; the rest name the
 * summarizer, the reason, what the session's behaviour now is and what to do about it.
 *
 * A single attempt announces exactly what it announced before a fallback existed: the extra lines
 * only appear once there is a second model to report.
 */
export function announcement(record: CompactionRecord, redistilling = false): string[] {
  const last = record.attempts[record.attempts.length - 1];
  if (last === undefined) return [...NO_ATTEMPTS];
  const earlier = record.attempts.slice(0, -1);
  const handback = handedBack(record);
  const lines = [
    handback
      ? 'degraded — compaction handed back to stock Pi'
      : 'recovered — the fallback summarizer produced the summary',
    `Summarizer: ${last.summarizer}`,
    handback
      ? `Why: ${last.reason}`
      : `Why: ${earlier.map((failed) => `${failed.summarizer} failed: ${failed.reason}`).join('; ')}; `
        + 'the fallback ran and its summary was complete',
  ];
  // A handback names every attempt that failed before the last one; a recovery already names them in
  // `Why:`, which is the only place a fallback's own reason can be reported.
  if (handback) for (const failed of earlier) lines.push(`Earlier: ${failed.summarizer} — ${failed.reason}`);
  lines.push(`Now: ${handback ? handBackCost(redistilling) : fallbackCost(last.thinking)}`, NEXT);
  return lines;
}

/** The one line `/compaction` reports a recorded outcome in. */
export function describeRecord(record: CompactionRecord): string {
  const last = record.attempts[record.attempts.length - 1];
  if (last === undefined) {
    return 'Last compaction: a record carrying no attempt, so neither the model that ran nor a failure can be read from it';
  }
  const earlier = record.attempts.slice(0, -1).map((failed) => `${failed.summarizer} — ${failed.reason}`);
  if (!handedBack(record)) {
    return `Last compaction: the fallback summarizer ${last.summarizer} produced the summary after ${earlier.join('; ')}`;
  }
  const suffix = earlier.length > 0 ? ` (after ${earlier.join('; ')})` : '';
  return `Last degradation: summarizer ${last.summarizer} — ${last.reason}${suffix}`;
}
