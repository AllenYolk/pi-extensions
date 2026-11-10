import { compact, getAgentDir } from '@earendil-works/pi-coding-agent';
import type {
  ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult,
  TurnEndEvent, TurnEndEventResult,
} from '@earendil-works/pi-coding-agent';
import {
  configPath,
  CONVERSATION_MODEL,
  DEFAULT_NEVER_PRUNE,
  defaults,
  effective,
  loadConfig,
  saveConfig,
  validateConfig,
  type Config,
  type Effective,
  type Selection,
  type ThinkingLevel,
} from './config.ts';
import { prepareCompaction } from './preparation.ts';
import {
  announcement,
  DEGRADATION_ENTRY,
  DEGRADATION_WIDGET,
  describeFailure,
  ladder,
  type Degradation,
} from './ladder.ts';
import {
  editedTargets,
  evaluatePruneGate,
  hostCompactionTrigger,
  isCompactionImminent,
  lastRequest,
  planPrune,
} from './prune.ts';
import {
  boundedStream,
  checkHostSeam,
  describeOutboundRequest,
  estimateSummaryTokens,
  HOST_PROMPT_AND_TOOLS_TOKENS,
  resolveSummarizerModel,
  summarizerThinkingLevel,
  type AttemptOutcome,
  type SeamResult,
} from './summarizer.ts';

/** The host's custom instructions plus a rung's budget instruction, in the order it appends them. */
const withInstruction = (base: string | undefined, extra: string | undefined): string | undefined =>
  (extra ? (base ? `${base}\n\n${extra}` : extra) : base);

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
  /** The host's own compaction trigger for the current model, which is what "imminent" means. */
  const trigger = (ctx: ExtensionContext) => hostCompactionTrigger(pi.getSettings(), ctx.model);

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
    // Inert until enabled, and `off` is the absence of a preset: stock Pi compacts.
    if (!settings.enabled || !tuple) return;

    /**
     * Every handback goes through here, so a degradation is announced the same way whatever caused
     * it. A cancellation is answered first: handing back would start a fresh compaction behind the
     * user, which is the one thing a cancellation must never do.
     */
    const handBack = (summarizer: string, reason: string): SessionBeforeCompactResult | void => {
      if (event.signal.aborted) return { cancel: true };
      pending = { preset: settings.preset, summarizer, reason };
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

    const thinking = summarizerThinkingLevel(model, tuple);
    const outbound = describeOutboundRequest(model, tuple, thinking, settings.keptWindowTokens);
    if (outbound.apiClass === 'no-ceiling') {
      // Proceeding would mean claiming a bound we do not have, which is worse than being inert.
      return handBack(
        named,
        `${outbound.api} sends no output-ceiling field, so the ${tuple.textBudget}-token text budget `
        + `and the ${tuple.reasoningBudget}-token reasoning budget would both be dropped`,
      );
    }
    const prepared = prepareCompaction(event.branchEntries, event.preparation, settings.keptWindowTokens);
    if (!prepared) return;

    // Two rungs, so the ladder cannot loop: the preset's own configuration, then one tighter one.
    const rungs = ladder(model, tuple, thinking);
    const failures: string[] = [];
    for (const [index, rung] of rungs.entries()) {
      if (event.signal.aborted) return { cancel: true };
      const last = index === rungs.length - 1;
      let outcome: AttemptOutcome | undefined;
      let result;
      try {
        result = await compact(
          prepared,
          model,
          undefined,
          undefined,
          withInstruction(event.customInstructions, rung.instruction),
          event.signal,
          rung.thinking as never,
          boundedStream(ctx.modelRegistry, rung.budgets, (seen) => { outcome = seen; }),
          undefined,
          undefined,
          undefined,
          ctx.sessionManager.getSessionId(),
        );
      } catch (error) {
        if (event.signal.aborted) return { cancel: true };
        failures.push(describeFailure(outcome, error));
        // A tighter configuration answers a length stop and an overlong summary, and nothing else:
        // a model error, a timeout or a malformed result would only be paid for twice.
        if (last || outcome?.stopReason !== 'length') break;
        continue;
      }
      if (event.signal.aborted) return { cancel: true };
      // Nothing the provider did not finish cleanly is persisted, whatever the host handed back.
      if (outcome && outcome.stopReason !== 'stop') {
        failures.push(describeFailure(outcome, undefined));
        break;
      }
      const tokens = estimateSummaryTokens(result.summary);
      if (tokens <= tuple.textBudget) return { compaction: result };
      failures.push(`the summarizer produced a ${tokens}-token summary, over the preset's ${tuple.textBudget}-token text budget`);
    }

    return handBack(named, failures.length > 1
      ? `${failures[0]}, and after a tighter retry (${rungs[1].tightening}) ${failures[1]}`
      : failures[0]);
  });

  /**
   * Prune at a turn boundary: the assistant and its tool results are persisted, and the next
   * request has not been made yet. All of a turn's edits are returned together, so the turn costs
   * one cache invalidation rather than one per pruned result.
   */
  pi.on('turn_end', (event: TurnEndEvent, ctx: ExtensionContext): TurnEndEventResult | void => {
    const settings = effective(config);
    // Inert until enabled; pruning is on once it is, and independent of the summarizer strategy.
    if (!settings.enabled || !settings.prune) return;

    const projection = ctx.sessionManager.buildSessionProjection();
    const gate = evaluatePruneGate(
      lastRequest(projection.entries),
      isCompactionImminent(ctx.getContextUsage(), trigger(ctx)),
      Date.now(),
    );
    if (!gate.armed) return;

    const plan = planPrune({
      entries: projection.entries,
      editedTargetIds: editedTargets(ctx.sessionManager.getBranch()),
      neverPrune: settings.neverPrune,
      pruneWindowTokens: settings.pruneWindowTokens,
    });
    if (plan.edits.length === 0) return;

    const many = plan.edits.length === 1 ? '' : 's';
    report(
      ctx,
      `pruned ${plan.edits.length} tool result${many} (${plan.toolNames.join(', ')}), ` +
      `omitting ${plan.omittedChars} characters; gate: ${gate.reason} — ${gate.detail}`,
      'info',
    );
    // Returning `entries` replaces that field, so any draft an earlier handler added is preserved.
    return { entries: [...event.entries, ...plan.edits] };
  });

  pi.registerCommand('compaction', {
    description: 'Show or change bounded compaction and pruning: preset, summarizer model, thinking, budgets, kept window, prune',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [verb, value] = args.trim().split(/\s+/, 2);
      if (!verb || verb === 'status') {
        ctx.ui.notify(await status(ctx), 'info');
        return;
      }
      const next: Config = { ...config };
      // A preset is the whole tuple; per-field overrides belong to the preset they were set on.
      const clearTuple = () => {
        next.summarizerModel = null;
        delete next.thinking;
        delete next.textBudget;
        delete next.reasoningBudget;
      };
      switch (verb) {
        case 'enable': next.enabled = true; break;
        case 'disable': next.enabled = false; break;
        case 'preset':
          if (!value) return void ctx.ui.notify('usage: /compaction preset fast|balanced|deep|off', 'error');
          next.preset = value as Selection;
          clearTuple();
          break;
        case 'model':
          if (!value) return void ctx.ui.notify(`usage: /compaction model provider/model | ${CONVERSATION_MODEL}`, 'error');
          next.summarizerModel = value === CONVERSATION_MODEL ? null : value;
          break;
        case 'thinking':
          if (!value) return void ctx.ui.notify('usage: /compaction thinking off|minimal|low|medium|high|xhigh|max', 'error');
          next.thinking = value as ThinkingLevel;
          break;
        case 'text': case 'reasoning': case 'window': {
          const field = verb === 'text' ? 'textBudget' : verb === 'reasoning' ? 'reasoningBudget' : 'keptWindowTokens';
          if (!value || !/^\d+$/.test(value)) return void ctx.ui.notify(`usage: /compaction ${verb} <tokens>`, 'error');
          next[field] = Number(value);
          break;
        }
        case 'prune':
          if (value !== 'on' && value !== 'off') return void ctx.ui.notify('usage: /compaction prune on|off', 'error');
          next.prune = value === 'on';
          break;
        case 'prune-window':
          if (!value || !/^\d+$/.test(value)) return void ctx.ui.notify('usage: /compaction prune-window <tokens>', 'error');
          next.pruneWindowTokens = Number(value);
          break;
        case 'never-prune': {
          if (!value) {
            return void ctx.ui.notify('usage: /compaction never-prune <tool>[,<tool>…] | default | none', 'error');
          }
          if (value === 'default') {
            next.neverPrune = [...DEFAULT_NEVER_PRUNE];
            break;
          }
          if (value === 'none') {
            next.neverPrune = [];
            break;
          }
          const tools = value.split(',').map((tool) => tool.trim()).filter(Boolean);
          if (tools.length === 0) {
            return void ctx.ui.notify('usage: /compaction never-prune <tool>[,<tool>…] | default | none', 'error');
          }
          next.neverPrune = tools;
          break;
        }
        default:
          ctx.ui.notify(
            `unknown setting ${verb}; try preset, model, thinking, text, reasoning, window, prune, prune-window, never-prune, enable, disable`,
            'error',
          );
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
    lines.push(`Preset: ${settings.preset}`);
    if (settings.tuple) {
      const tuple = settings.tuple;
      const model = resolveSummarizerModel(tuple, ctx);
      const wanted = tuple.model === null ? `${CONVERSATION_MODEL} model` : tuple.model;
      const described = model ? `${model.provider}/${model.id} (${model.api})` : `${wanted} — not available on this host`;
      const thinking = model ? summarizerThinkingLevel(model, tuple) : tuple.thinking;
      const why = thinking === tuple.thinking ? ''
        : tuple.reasoningBudget === 0 ? ' (no reasoning budget)'
          : ` (clamped from ${tuple.thinking})`;
      lines.push(`Summarizer model: ${described}`);
      lines.push(`Thinking: ${thinking}${why}`);
      lines.push(`Text budget: ${tuple.textBudget}`);
      lines.push(`Reasoning budget: ${tuple.reasoningBudget}`);
      if (model) {
        const outbound = describeOutboundRequest(model, tuple, thinking, settings.keptWindowTokens);
        if (outbound.apiClass === 'no-ceiling') {
          lines.push(`Outbound: no-ceiling API ${outbound.api} — it sends no output-ceiling field, so neither budget can be enforced`);
          lines.push('Reasoning budget on this API: not applied');
          lines.push('Worst case: the summary is not bounded by this package');
        } else {
          const capped = outbound.outputFieldCeiling! < tuple.textBudget + outbound.reasoningTokens && !outbound.providerDependent
            ? ` (capped by the model's own ${outbound.modelLimit})`
            : '';
          const dependent = outbound.providerDependent
            ? '; whether the provider counts thinking against its output field is untested — verify before relying on a number'
            : '';
          lines.push(`Outbound: ${outbound.apiClass} API ${outbound.api} — the provider sees an output ceiling of ${outbound.outputFieldCeiling}${capped}${dependent}`);
          const effect = outbound.reasoningBudget === 'enforced'
            ? outbound.textRoomGuaranteed
              ? `enforced as a thinking budget of ${outbound.reasoningTokens}; at least ${tuple.textBudget} of room remains available for text`
              : `enforced as a thinking budget of ${outbound.reasoningTokens}; the room left for text depends on the provider`
            : outbound.reasoningBudget === 'advisory'
              ? `advisory — ${outbound.api} sends a reasoning effort level, not a token cap, so the reasoning phase draws uncapped from the same pool and the text has no independent ceiling`
              : 'not sent — the summarizer does not reason';
          lines.push(`Reasoning budget on this API: ${effect}`);
          lines.push(
            `Worst case: summary ${outbound.worstCaseSummaryTokens} tokens; base context ` +
            `${HOST_PROMPT_AND_TOOLS_TOKENS} + ${outbound.worstCaseSummaryTokens} + ${settings.keptWindowTokens} = ` +
            `${outbound.worstCaseBaseContextTokens} tokens`,
          );
        }
      }
    } else {
      lines.push('Compaction: stock Pi');
    }
    lines.push(`Kept window: ${settings.keptWindowTokens} tokens`);
    lines.push(...pruneStatus(ctx, settings));
    const checked = await seamResult();
    lines.push(`Host seam: ${checked.ok ? 'ok' : 'MISMATCH'} — ${checked.detail}`);
    const degraded = lastDegradation(ctx);
    lines.push(degraded
      ? `Last degradation: preset ${degraded.preset} — ${degraded.reason}`
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

  /** Whether pruning is armed right now, and which gate decided it. */
  function pruneStatus(ctx: ExtensionCommandContext, settings: Effective): string[] {
    const lines = [`Prune: ${settings.prune ? 'on' : 'off'}`];
    lines.push(`Prune window: ${settings.pruneWindowTokens} tokens of recent tool results`);
    lines.push(settings.neverPrune.length === 0
      ? 'Never prune: (none) — every tool result is prunable, including results the agent cannot recover by re-running'
      : `Never prune: ${settings.neverPrune.join(', ')}`);
    if (!settings.enabled || !settings.prune) {
      lines.push(`Prune gate: not evaluated — pruning is ${settings.enabled ? 'off' : 'inert until the package is enabled'}`);
      return lines;
    }
    const gate = evaluatePruneGate(
      lastRequest(ctx.sessionManager.buildSessionProjection().entries),
      isCompactionImminent(ctx.getContextUsage(), trigger(ctx)),
      Date.now(),
    );
    lines.push(`Prune gate: ${gate.armed ? 'armed' : 'blocked'} (${gate.reason}) — ${gate.detail}`);
    return lines;
  }
}
