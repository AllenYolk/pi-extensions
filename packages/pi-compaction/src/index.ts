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
  announcement,
  DEGRADATION_ENTRY,
  DEGRADATION_WIDGET,
  describeFailure,
  UNOBSERVED_RESPONSE,
  type Degradation,
} from './degradation.ts';
import {
  checkHostSeam,
  hostRetryPolicy,
  observingStream,
  resolveSummarizerModel,
  summarizerThinkingLevel,
  type AttemptOutcome,
  type SeamResult,
} from './summarizer.ts';

export default function piCompaction(pi: ExtensionAPI): void {
  let config: Config = defaults();
  let diagnostic: string | undefined;
  let seam: Promise<SeamResult> | undefined;
  /** The degradation raised inside a compaction, waiting for the compaction to settle. */
  let pending: Degradation | undefined;

  const reload = () => {
    const loaded = loadConfig(getAgentDir());
    config = loaded.config ?? defaults();
    diagnostic = loaded.diagnostic;
  };
  const seamResult = () => (seam ??= checkHostSeam());
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
    const degradation = pending;
    pending = undefined;
    if (!degradation) {
      // A compaction that completed resolves whatever an earlier one degraded into.
      if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, undefined);
      return;
    }
    pi.appendEntry(DEGRADATION_ENTRY, degradation);
    if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, announcement(degradation));
  };

  pi.on('session_start', (_event, ctx) => {
    reload();
    seam = undefined;
    pending = undefined;
    if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, undefined);
    // Activation-time check: the status view reports it, and the hook awaits the same promise.
    void seamResult();
  });

  pi.on('session_compact', (_event, ctx) => settle(ctx));
  pi.on('session_compact_failed', (_event, ctx) => settle(ctx));

  pi.on('session_shutdown', (_event, ctx) => {
    config = defaults();
    diagnostic = undefined;
    seam = undefined;
    pending = undefined;
    if (ctx.hasUI) ctx.ui.setWidget(DEGRADATION_WIDGET, undefined);
  });

  pi.on('session_before_compact', async (event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<SessionBeforeCompactResult | void> => {
    const settings = effective(config);
    const tuple = settings.tuple;
    // Inert until enabled: installing the package changes nothing.
    if (!settings.enabled) return;

    /**
     * Every handback goes through here, so a degradation is announced the same way whatever caused
     * it. A cancellation is answered first: handing back would start a fresh compaction behind the
     * user, which is the one thing a cancellation must never do.
     */
    const handBack = (summarizer: string, reason: string): SessionBeforeCompactResult | void => {
      if (event.signal.aborted) return { cancel: true };
      pending = { summarizer, reason };
      report(ctx, announcement(pending).join('\n'), 'error');
      return undefined;
    };

    const checked = await seamResult();
    if (!checked.ok) return handBack('none — the seam was never reached', `host seam mismatch (${checked.detail})`);

    const model = resolveSummarizerModel(tuple, ctx);
    if (!model) {
      const wanted = tuple.model === null ? 'the conversation model' : `summarizer model ${tuple.model}`;
      return handBack(tuple.model ?? CONVERSATION_MODEL, `this host does not offer ${wanted}`);
    }
    const named = `${model.provider}/${model.id} (${model.api})`;
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) return handBack(named, 'the host has no configured credentials for it');

    const prepared = prepareCompaction(event.branchEntries, event.preparation, settings.keptWindowTokens);
    if (!prepared) {
      return handBack(
        named,
        'the cut point leaves no history to summarise, so the host would carry the previous summary '
        + 'forward and this package could not choose what produced it',
      );
    }

    // One request. The model and its thinking level are two of the three things this package changes;
    // the summary is otherwise the host's, at whatever length the host's prompt and the model produce.
    //
    // Responses are grouped by the context they came from. The host's retry policy calls the stream
    // function again with the same context after a transient failure, and only the response it
    // finally returns is the one `compact()` acted on — so a later response replaces an earlier one,
    // and a failure that was retried away must not be read as this attempt's outcome. A split turn
    // summarises two ranges through two contexts, and both of those have to be clean.
    const outcomes = new Map<object, AttemptOutcome>();
    let result;
    try {
      result = await compact(
        prepared,
        model,
        undefined,
        undefined,
        event.customInstructions,
        event.signal,
        summarizerThinkingLevel(model, tuple) as never,
        observingStream(ctx.modelRegistry, (group, seen) => { outcomes.set(group, seen); }),
        undefined,
        hostRetryPolicy(pi.getSettings()),
        undefined,
        ctx.sessionManager.getSessionId(),
      );
    } catch (error) {
      if (event.signal.aborted) return { cancel: true };
      return handBack(named, describeFailure([...outcomes.values()].at(-1), error));
    }
    if (event.signal.aborted) return { cancel: true };

    /**
     * The whole of this package's quality guarantee: a summary it cannot vouch for is never
     * persisted. The host throws on an error and on a tool call, so those never reach here; it
     * returns a partially written summary **unchanged** for any other stop reason, which is what this
     * check exists to refuse.
     *
     * Every response the attempt kept is checked, not only the last one — see the grouping above —
     * and a response with no stop reason this package recognises is refused too, because an
     * unrecognised response is not a proven-complete one.
     */
    const responses = [...outcomes.values()];
    const unclean = responses.find((seen) => seen.stopReason !== 'stop');
    if (responses.length === 0 || unclean) {
      return handBack(named, unclean ? describeFailure(unclean, undefined) : UNOBSERVED_RESPONSE);
    }
    return { compaction: result };
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
        case 'thinking':
          if (!value) return void ctx.ui.notify('usage: /compaction thinking off|minimal|low|medium|high|xhigh|max', 'error');
          next.thinking = value as ThinkingLevel;
          break;
        case 'window':
          if (!value || !/^\d+$/.test(value)) return void ctx.ui.notify('usage: /compaction window <tokens>', 'error');
          next.keptWindowTokens = Number(value);
          break;
        default:
          ctx.ui.notify('unknown setting; try model, thinking, window, enable, disable', 'error');
          return;
      }
      const invalid = validateConfig(next);
      if (invalid) {
        ctx.ui.notify(`pi-compaction: nothing changed; ${invalid}`, 'error');
        return;
      }
      saveConfig(getAgentDir(), next);
      config = next;
      ctx.ui.notify(await status(ctx), 'info');
    },
  });

  async function status(ctx: ExtensionCommandContext): Promise<string> {
    const settings = effective(config);
    const lines = [diagnostic ? `Config rejected: ${diagnostic}` : `Config: ${configPath(getAgentDir())}`];
    lines.push(`Enabled: ${settings.enabled ? 'yes' : 'no'}`);
    const tuple = settings.tuple;
    const model = resolveSummarizerModel(tuple, ctx);
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
    lines.push(`Kept window: ${settings.keptWindowTokens} tokens`);
    lines.push('Summary length: not bounded by this package — the host sends no output ceiling and neither do we');
    const checked = await seamResult();
    lines.push(`Host seam: ${checked.ok ? 'ok' : 'MISMATCH'} — ${checked.detail}`);
    const degraded = lastDegradation(ctx);
    lines.push(degraded
      ? `Last degradation: summarizer ${degraded.summarizer} — ${degraded.reason}`
      : 'Last degradation: none in this session');
    return lines.join('\n');
  }

  /** The most recent degradation this package recorded in the session, if there is one. */
  function lastDegradation(ctx: ExtensionCommandContext): Degradation | undefined {
    const branch = ctx.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type === 'custom' && entry.customType === DEGRADATION_ENTRY) return entry.data as Degradation;
    }
    return undefined;
  }
}
