import { compact, getAgentDir } from '@earendil-works/pi-coding-agent';
import type {
  ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult,
} from '@earendil-works/pi-coding-agent';
import {
  configPath,
  CONVERSATION_MODEL,
  defaults,
  effective,
  loadConfig,
  saveConfig,
  validateConfig,
  type Config,
  type ThinkingLevel,
} from './config.ts';
import { prepareCompaction } from './preparation.ts';
import {
  checkTokenSeam,
  redistillFor,
  redistillInstructions,
  redistillStatus,
} from './redistill.ts';
import {
  announcement,
  DEGRADATION_ENTRY,
  DEGRADATION_WIDGET,
  describeFailure,
  describeRecord,
  FALLBACK_ENTRY,
  handedBack,
  toRecord,
  UNOBSERVED_RESPONSE,
  type Attempt,
  type CompactionRecord,
} from './degradation.ts';
import {
  checkHostSeam,
  hostRetryPolicy,
  observingStream,
  resolveModel,
  summarizerThinkingLevel,
  type AttemptOutcome,
  type SeamResult,
  type SummarizationPreparation,
} from './summarizer.ts';

/**
 * `compactFn` is the host function this package probes at activation *and* compacts with. It exists
 * so a test can hand the extension a host whose `compact()` has another shape — unreachable from a
 * real run, because the host this package is developed against passes — and prove what a mismatch
 * and a cancellation each attempt.
 */
export default function piCompaction(pi: ExtensionAPI, compactFn: typeof compact = compact): void {
  let config: Config = defaults();
  let diagnostic: string | undefined;
  let seam: Promise<SeamResult> | undefined;
  let tokenSeam: SeamResult | undefined;
  /**
   * What the compaction did when its summarizer did not produce the summary, waiting for it to settle,
   * with the redistilling setting that was in force when it was raised. The setting is captured here
   * rather than read at settle time: a `/reload` between the two would otherwise let the pinned widget
   * describe a configuration that was not the one that ran.
   */
  let pending: { record: CompactionRecord; redistilling: boolean } | undefined;

  const reload = () => {
    const loaded = loadConfig(getAgentDir());
    config = loaded.config ?? defaults();
    diagnostic = loaded.diagnostic;
  };
  const seamResult = () => (seam ??= checkHostSeam(compactFn));
  const tokenSeamResult = () => (tokenSeam ??= checkTokenSeam());
  const report = (ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    const line = `pi-compaction: ${message}`;
    if (ctx.hasUI) ctx.ui.notify(line, type);
    // A notification raised from inside a compaction does not always reach the terminal before the
    // host repaints over it, and a warning that can be missed is not a warning.
    console.error(line);
  };

  /**
   * The durable half of a degradation, written once the compaction has settled.
   *
   * Anything raised inside `session_before_compact` is lost to the repaint: the host clears and
   * rebuilds the transcript when the compaction ends, and a notification raised before that never
   * reaches the terminal. So the announcement is pinned above the editor — chrome the repaint does
   * not touch — and recorded as a custom session entry, which carries no LLM context and survives a
   * restart. `/compaction` reads that entry back, which is the part that stays visible afterwards.
   */
  const settle = (ctx: ExtensionContext) => {
    const raised = pending;
    pending = undefined;
    if (!raised) {
      // A compaction that completed resolves whatever an earlier one degraded into.
      if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, undefined);
      return;
    }
    pi.appendEntry(handedBack(raised.record) ? DEGRADATION_ENTRY : FALLBACK_ENTRY, raised.record);
    if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, announcement(raised.record, raised.redistilling));
  };

  pi.on('session_start', (_event, ctx) => {
    reload();
    seam = undefined;
    tokenSeam = undefined;
    pending = undefined;
    if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, undefined);
    // Activation-time checks: the status view reports them, and the hook awaits the same promise.
    void seamResult();
    tokenSeamResult();
  });

  pi.on('session_compact', (_event, ctx) => settle(ctx));
  pi.on('session_compact_failed', (_event, ctx) => settle(ctx));

  pi.on('session_shutdown', (_event, ctx) => {
    config = defaults();
    diagnostic = undefined;
    seam = undefined;
    tokenSeam = undefined;
    pending = undefined;
    if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, undefined);
  });

  pi.on('session_before_compact', async (event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<SessionBeforeCompactResult | void> => {
    const settings = effective(config);
    const tuple = settings.tuple;
    // Nothing is asked for unless this host's token estimate checked out; see `checkTokenSeam`.
    const redistill = redistillFor(settings.redistill, tokenSeamResult());
    // Inert until enabled: installing the package changes nothing.
    if (!settings.enabled) return;

    /**
     * Every handback goes through here, so a degradation is announced the same way whatever caused
     * it. A cancellation is answered first: handing back would start a fresh compaction behind the
     * user, which is the one thing a cancellation must never do.
     */
    const handBack = (attempts: Attempt[]): SessionBeforeCompactResult | void => {
      if (event.signal.aborted) return { cancel: true };
      pending = { record: { attempts }, redistilling: redistill !== null };
      report(ctx, announcement(pending.record, pending.redistilling).join('\n'), 'error');
      return undefined;
    };

    const checked = await seamResult();
    // Nothing about a second model fixes a seam the first one cannot use, and two failed attempts
    // would only make the announcement worse.
    if (!checked.ok) {
      return handBack([{ summarizer: 'none — the seam was never reached', reason: `host seam mismatch (${checked.detail})` }]);
    }

    /**
     * The resolution order: the configured summarizer, then the configured fallback, then the host.
     * Only a failed attempt falls through — a cancellation, a seam mismatch and a cut point with
     * nothing to summarise all end the compaction here, because none of them is a request a second
     * model could make.
     */
    const candidates = settings.fallbackModel === null ? [tuple.model] : [tuple.model, settings.fallbackModel];
    const attempts: Attempt[] = [];
    // The same range for every attempt: a fallback is a different model, not a different compaction.
    let prepared: SummarizationPreparation | undefined;

    for (const wanted of candidates) {
      // A cancellation that started a fresh request behind the user's back is the one thing the
      // handback path is careful about, so the signal is read before each attempt, not only after.
      if (event.signal.aborted) return { cancel: true };

      const model = resolveModel(wanted, ctx);
      if (!model) {
        const described = wanted === null ? 'the conversation model' : `summarizer model ${wanted}`;
        attempts.push({ summarizer: wanted ?? CONVERSATION_MODEL, reason: `this host does not offer ${described}` });
        continue;
      }
      const named = `${model.provider}/${model.id} (${model.api})`;
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        attempts.push({ summarizer: named, reason: 'the host has no configured credentials for it' });
        continue;
      }

      prepared ??= prepareCompaction(event.branchEntries, event.preparation, settings.keptWindowTokens);
      if (!prepared) {
        // There is no request to make, so there is nothing a different model could do about it.
        attempts.push({
          summarizer: named,
          reason: 'the cut point leaves no history to summarise, so the host would carry the previous summary '
            + 'forward and this package could not choose what produced it',
        });
        return handBack(attempts);
      }

      // One request. The model and its thinking level are two of the three things this package changes;
      // the summary is otherwise the host's, at whatever length the host's prompt and the model produce.
      //
      // The custom-instruction slot is a fourth, and the only lever that does not touch the response:
      // redistilling asks for a fixed point instead of a union, and appends to whatever
      // `/compact <text>` supplied rather than replacing it.
      //
      // The level is clamped against **this** model, so it is computed per attempt: a fallback that
      // cannot honour the configured level runs at a different one, and the announcement names the
      // level that ran rather than the one that was asked for.
      //
      // Responses are grouped by the context they came from. The host's retry policy calls the stream
      // function again with the same context after a transient failure, and only the response it
      // finally returns is the one `compact()` acted on — so a later response replaces an earlier one,
      // and a failure that was retried away must not be read as this attempt's outcome. A split turn
      // summarises two ranges through two contexts, and both of those have to be clean.
      const level = summarizerThinkingLevel(model, tuple);
      const outcomes = new Map<object, AttemptOutcome>();
      let result;
      try {
        result = await compactFn(
          prepared,
          model,
          undefined,
          undefined,
          redistillInstructions(prepared.previousSummary, redistill, event.customInstructions, prepared.isSplitTurn),
          event.signal,
          level as never,
          observingStream(ctx.modelRegistry, (group, seen) => { outcomes.set(group, seen); }),
          undefined,
          hostRetryPolicy(pi.getSettings()),
          undefined,
          ctx.sessionManager.getSessionId(),
        );
      } catch (error) {
        if (event.signal.aborted) return { cancel: true };
        attempts.push({ summarizer: named, reason: describeFailure([...outcomes.values()].at(-1), error) });
        continue;
      }
      if (event.signal.aborted) return { cancel: true };

      /**
       * The whole of this package's quality guarantee: a summary it cannot vouch for is never
       * persisted, whichever model wrote it. The host throws on an error and on a tool call, so those
       * never reach here; it returns a partially written summary **unchanged** for any other stop
       * reason, which is what this check exists to refuse.
       *
       * Every response the attempt kept is checked, not only the last one — see the grouping above —
       * and a response with no stop reason this package recognises is refused too, because an
       * unrecognised response is not a proven-complete one.
       */
      const responses = [...outcomes.values()];
      const unclean = responses.find((seen) => seen.stopReason !== 'stop');
      if (responses.length === 0 || unclean) {
        attempts.push({ summarizer: named, reason: unclean ? describeFailure(unclean, undefined) : UNOBSERVED_RESPONSE });
        continue;
      }

      if (attempts.length === 0) return { compaction: result };
      // The fallback wrote a summary this package can vouch for. Recording it is the point: the
      // operator configured the primary for a reason, and a handback announcement here would be a lie.
      attempts.push({
        summarizer: named,
        thinking: level === tuple.thinking ? { level } : { level, clampedFrom: tuple.thinking },
      });
      pending = { record: { attempts }, redistilling: redistill !== null };
      report(ctx, announcement(pending.record, pending.redistilling).join('\n'), 'warning');
      return { compaction: result };
    }
    return handBack(attempts);
  });

  pi.registerCommand('compaction', {
    description: 'Show or change which model compacts this session, and how hard it thinks',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [verb, value] = args.trim().split(/\s+/, 2);
      if (!verb || verb === 'status') {
        ctx.ui.notify(await status(ctx), 'info');
        return;
      }
      const next: Config = { ...config };
      switch (verb) {
        case 'enable': next.enabled = true; break;
        case 'disable': next.enabled = false; break;
        case 'model':
          if (!value) return void ctx.ui.notify(`usage: /compaction model provider/model | ${CONVERSATION_MODEL}`, 'error');
          next.summarizerModel = value === CONVERSATION_MODEL ? null : value;
          break;
        case 'fallback':
          if (!value) {
            return void ctx.ui.notify(`usage: /compaction fallback provider/model | ${CONVERSATION_MODEL} | none`, 'error');
          }
          // `none` is the command's own spelling for the same thing `conversation` means here: not a
          // second model. Neither ever means the conversation model as a fallback — the host handback
          // already is that, and saying it twice would hide which one happened.
          next.fallbackModel = value === CONVERSATION_MODEL || value === 'none' ? null : value;
          break;
        case 'thinking':
          if (!value) return void ctx.ui.notify('usage: /compaction thinking off|minimal|low|medium|high|xhigh|max', 'error');
          next.thinking = value as ThinkingLevel;
          break;
        case 'window':
          if (!value || !/^\d+$/.test(value)) return void ctx.ui.notify('usage: /compaction window <tokens>', 'error');
          next.keptWindowTokens = Number(value);
          break;
        default:
          ctx.ui.notify('unknown setting; try model, fallback, thinking, window, enable, disable', 'error');
          return;
      }
      const invalid = validateConfig(next);
      if (invalid) {
        ctx.ui.notify(`pi-compaction: nothing changed; ${invalid}`, 'error');
        return;
      }
      // A save can still refuse: `redistill` is file-only, and a save must not erase a value the
      // parse did not adopt. The message says what to do about it. It can also adopt a `redistill` the
      // file carries, so the configuration the status view reports afterwards is the one that was
      // written, not the one that was asked for.
      try {
        config = saveConfig(getAgentDir(), next);
      } catch (error) {
        ctx.ui.notify(`pi-compaction: nothing changed; ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
      }
      ctx.ui.notify(await status(ctx), 'info');
    },
  });

  async function status(ctx: ExtensionCommandContext): Promise<string> {
    const settings = effective(config);
    const lines = [diagnostic ? `Config rejected: ${diagnostic}` : `Config: ${configPath(getAgentDir())}`];
    lines.push(`Enabled: ${settings.enabled ? 'yes' : 'no'}`);
    const tuple = settings.tuple;
    const model = resolveModel(tuple.model, ctx);
    const wanted = tuple.model === null ? `${CONVERSATION_MODEL} model` : tuple.model;
    const described = model ? `${model.provider}/${model.id} (${model.api})` : `${wanted} — not available on this host`;
    lines.push(`Summarizer model: ${described}`);
    if (model) {
      const thinking = summarizerThinkingLevel(model, tuple);
      // A model whose `thinkingLevelMap` marks the requested level unsupported gets the host's own
      // clamp, and it then thinks anyway — so the level that was used is what gets reported.
      const why = thinking === tuple.thinking ? ''
        : tuple.thinking === 'off'
          ? ` (clamped from off; this model has no off, so its reasoning phase still runs)`
          : ` (clamped from ${tuple.thinking})`;
      lines.push(`Thinking: ${thinking}${why}`);
    } else {
      lines.push(`Thinking: ${tuple.thinking}`);
    }
    // A fallback that this host cannot run is worth saying now rather than at the next compaction.
    const fallback = settings.fallbackModel === null ? undefined : resolveModel(settings.fallbackModel, ctx);
    lines.push(settings.fallbackModel === null
      ? 'Fallback model: none'
      : fallback === undefined
        ? `Fallback model: ${settings.fallbackModel} — not available on this host`
        : `Fallback model: ${fallback.provider}/${fallback.id} (${fallback.api})`
          + (ctx.modelRegistry.hasConfiguredAuth(fallback) ? '' : ' — no configured credentials on this host'));
    lines.push(`Kept window: ${settings.keptWindowTokens} tokens`);
    lines.push(redistillStatus(settings.redistill, tokenSeamResult()));
    lines.push('Summary length: not bounded by this package — the host sends no output ceiling and neither do we');
    const checked = await seamResult();
    lines.push(`Host seam: ${checked.ok ? 'ok' : 'MISMATCH'} — ${checked.detail}`);
    const recorded = lastRecord(ctx);
    lines.push(recorded ? describeRecord(recorded) : 'Last degradation: none in this session');
    return lines.join('\n');
  }

  /** The most recent outcome this package recorded in the session, if there is one. */
  function lastRecord(ctx: ExtensionCommandContext): CompactionRecord | undefined {
    const branch = ctx.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type !== 'custom') continue;
      if (entry.customType !== DEGRADATION_ENTRY && entry.customType !== FALLBACK_ENTRY) continue;
      // A record written by 0.2.1 carries the single-attempt shape; `toRecord` reads it rather than
      // skipping it, because a session outlives the version that compacted it and this entry is the
      // half of the announcement that survives a restart.
      const record = toRecord(entry.data);
      if (record) return record;
    }
    return undefined;
  }
}
