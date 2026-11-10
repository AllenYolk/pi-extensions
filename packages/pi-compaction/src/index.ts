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
  outputBudgets,
  resolveSummarizerModel,
  summarizerThinkingLevel,
  type SeamResult,
} from './summarizer.ts';
export default function piCompaction(pi: ExtensionAPI): void {
  let config: Config = defaults();
  let diagnostic: string | undefined;
  let seam: Promise<SeamResult> | undefined;

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

  pi.on('session_start', () => {
    reload();
    seam = undefined;
    // Activation-time check: the status view reports it, and the hook awaits the same promise.
    void seamResult();
  });

  pi.on('session_shutdown', () => {
    config = defaults();
    diagnostic = undefined;
    seam = undefined;
  });

  pi.on('session_before_compact', async (event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<SessionBeforeCompactResult | void> => {
    const settings = effective(config);
    const tuple = settings.tuple;
    // Inert until enabled, and `off` is the absence of a preset: stock Pi compacts.
    if (!settings.enabled || !tuple) return;

    const checked = await seamResult();
    if (!checked.ok) {
      report(ctx, `host seam mismatch (${checked.detail}); compaction handed back to Pi`);
      return;
    }
    const model = resolveSummarizerModel(tuple, ctx);
    if (!model) {
      report(ctx, `preset ${settings.preset} names summarizer model ${tuple.model}, which this host does not offer; compaction handed back to Pi`);
      return;
    }
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
      report(ctx, `summarizer model ${model.provider}/${model.id} has no configured credentials; compaction handed back to Pi`);
      return;
    }
    const thinking = summarizerThinkingLevel(model, tuple);
    const outbound = describeOutboundRequest(model, tuple, thinking, settings.keptWindowTokens);
    if (outbound.apiClass === 'no-ceiling') {
      // Proceeding would mean claiming a bound we do not have, which is worse than being inert.
      report(
        ctx,
        `preset ${settings.preset} cannot bound the summary: ${outbound.api} sends no output-ceiling field, so its ` +
        `${tuple.textBudget}-token text budget and ${tuple.reasoningBudget}-token reasoning budget would be dropped; ` +
        'compaction handed back to Pi',
      );
      return;
    }
    const prepared = prepareCompaction(event.branchEntries, event.preparation, settings.keptWindowTokens);
    if (!prepared) return;

    const budgets = outputBudgets(model, tuple, thinking);    let result;
    try {
      result = await compact(
        prepared,
        model,
        undefined,
        undefined,
        event.customInstructions,
        event.signal,
        thinking as never,
        boundedStream(ctx.modelRegistry, budgets),
        undefined,
        undefined,
        undefined,
        ctx.sessionManager.getSessionId(),
      );
    } catch (error) {
      // A cancellation stops here: handing back would start a fresh compaction behind the user.
      if (event.signal.aborted) return { cancel: true };
      report(ctx, `preset ${settings.preset} could not summarise (${String(error)}); compaction handed back to Pi`);
      return;
    }

    const tokens = estimateSummaryTokens(result.summary);
    if (tokens > tuple.textBudget) {
      report(
        ctx,
        `preset ${settings.preset} produced a ${tokens}-token summary, over its ${tuple.textBudget}-token text budget; ` +
          'it is not persisted and compaction is handed back to Pi',
      );
      return;
    }
    return { compaction: result };
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
      `omitting ${plan.omittedChars} characters; gate: ${gate.detail}`,
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
    return lines.join('\n');
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
    lines.push(`Prune gate: ${gate.armed ? `armed (${gate.gate})` : 'blocked'} — ${gate.detail}`);
    return lines;
  }
}
