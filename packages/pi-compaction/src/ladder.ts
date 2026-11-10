import type { Selection, ThinkingLevel, Tuple } from './config.ts';
import {
  apiClassOf,
  outputBudgets,
  type AttemptOutcome,
  type OutputBudgets,
  type SummarizerModel,
} from './summarizer.ts';

/**
 * The retry ladder and the announcement that ends it.
 *
 * A hard ceiling on a model that wants to write more produces a length stop, and a model that
 * ignores the budget produces a summary over it. Either one used to end in the same place: warn and
 * hand compaction back to stock Pi — which is the unbounded summary this package exists to remove.
 * So the ladder answers both with one bounded retry, and whatever is left is a degradation, which
 * is announced rather than printed.
 *
 * A no-ceiling model never reaches the ladder: the hook hands it back before any request, because a
 * tighter configuration of a ceiling the provider will not carry is not a bound.
 */

/** The custom session entry a degradation is recorded as. Custom entries carry no LLM context. */
export const DEGRADATION_ENTRY = 'pi-compaction-degradation';

/** The widget the announcement is pinned under, so a later compaction can take it down. */
export const DEGRADATION_WIDGET = 'pi-compaction-degradation';

/** One rung: everything a single summarization attempt sends that the next one changes. */
export interface Rung {
  thinking: ThinkingLevel;
  budgets: OutputBudgets;
  /** Appended to the host's custom instructions, which it renders as an "Additional focus" section. */
  instruction?: string;
  /** What this rung tightens, quoted verbatim in the announcement when it fails as well. */
  tightening: string;
}

/**
 * The whole ladder: the preset's own configuration, then exactly one tighter retry.
 *
 * Two rungs is the bound, and it is a fixed array rather than a loop with a condition, so there is
 * no third attempt to reach however the second one fails.
 */
export function ladder(model: SummarizerModel, tuple: Tuple, thinking: ThinkingLevel): Rung[] {
  return [
    {
      thinking,
      budgets: outputBudgets(model, tuple, thinking),
      tightening: "the preset's own model, thinking level and both budgets",
    },
    tighterRung(model, tuple, thinking),
  ];
}

/**
 * The tighter retry, which is not the same shape on both enforceable classes.
 *
 * The difference is whether the reasoning budget reaches the provider as a token cap. Where it
 * does, a length stop may only mean the thinking phase ate the quota the text needed, and cutting
 * both budgets fixes that. Where it does not, reasoning drew from one envelope uncapped and the
 * envelope really was exhausted, so the retry has to stop the reasoning draw instead — and must not
 * shrink the envelope while doing it, because the acceptance test is on the text and a model told
 * to stay inside the text budget still needs room to stop cleanly rather than hit the cap again.
 */
function tighterRung(model: SummarizerModel, tuple: Tuple, thinking: ThinkingLevel): Rung {
  if (apiClassOf(model) === 'answer-budget') {
    const textBudget = halve(tuple.textBudget);
    const reasoningBudget = halve(tuple.reasoningBudget);
    return {
      thinking,
      budgets: outputBudgets(model, { ...tuple, textBudget, reasoningBudget }, thinking),
      tightening: `text budget ${tuple.textBudget} to ${textBudget}, reasoning budget ${tuple.reasoningBudget} to ${reasoningBudget}`,
    };
  }
  return {
    thinking: 'off',
    budgets: outputBudgets(model, tuple, 'off', { keepPool: true }),
    instruction: budgetInstruction(tuple.textBudget),
    tightening: `thinking off and an explicit ${tuple.textBudget}-token budget instruction, with the envelope unchanged`,
  };
}

/** Halved, and never below one token. A zero reasoning budget stays zero: it means "do not reason". */
const halve = (tokens: number): number => (tokens === 0 ? 0 : Math.max(1, Math.floor(tokens / 2)));

/**
 * The budget in words.
 *
 * The host appends `customInstructions` to its summarization prompt as an "Additional focus"
 * section, which is the only place a budget can be stated on an API whose ceiling is one pool the
 * adapter will not divide for us.
 */
export function budgetInstruction(textBudget: number): string {
  return `Keep the entire summary within ${textBudget} tokens. An earlier attempt ran past its output `
    + 'ceiling and was discarded, so write a shorter summary rather than an incomplete one: drop '
    + 'detail, and keep exact file paths, function names and error messages.';
}

/** Why the ladder gave up, in the package's own words rather than the host's. */
export function describeFailure(outcome: AttemptOutcome | undefined, error: unknown): string {
  if (outcome?.stopReason === 'length') return 'the summarizer hit its output ceiling, so the summary was incomplete';
  if (outcome?.toolCall) return 'the summarizer tried to call a tool instead of writing a summary';
  if (outcome?.stopReason === 'error') return `the summarizer reported an error (${messageOf(error)})`;
  if (outcome) return `the summarizer's response stopped with "${outcome.stopReason}" instead of finishing, so the summary may be partial`;
  return `the summarizer did not produce a summary (${messageOf(error)})`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface Degradation {
  preset: Selection;
  /** What the preset asked to summarise with, or what there was instead. */
  summarizer: string;
  /** Why the ladder gave up. */
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
