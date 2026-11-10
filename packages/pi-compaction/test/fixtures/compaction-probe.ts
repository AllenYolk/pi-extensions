import { writeFileSync } from 'node:fs';
import { estimateTokens, type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

/**
 * Drives one or more real compactions through the running CLI and reports what the session ended
 * up with. Everything it asserts on is read back from the session the host wrote.
 *
 * `PI_COMPACTION_PROBE_RESULT`   file the report is written to
 * `PI_COMPACTION_PROBE_MODEL`    `provider/model` the session runs on
 * `PI_COMPACTION_PROBE_THINKING` session thinking level, to prove it does not leak into the summarizer
 * `PI_COMPACTION_PROBE_ROUNDS`   compactions to run; a round after the first appends a turn first
 * `PI_COMPACTION_PROBE_RELOADS`  `/reload` cycles before the first compaction
 */

type Text = { type: 'text'; text: string };

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return '';
      const record = block as Record<string, unknown>;
      if (record.type === 'text' || record.type === 'thinking') return String(record.text ?? record.thinking ?? '');
      if (record.type === 'toolCall') return `${String(record.name)} ${JSON.stringify(record.arguments)}`;
      return '';
    })
    .join('\n');
};

export default function probe(pi: ExtensionAPI) {
  pi.registerCommand('compaction-probe', {
    description: 'pi-compaction test harness; not part of any published package',
    handler: async (_args, ctx) => {
      const destination = process.env.PI_COMPACTION_PROBE_RESULT;
      if (!destination) throw new Error('PI_COMPACTION_PROBE_RESULT is required');
      const report: Record<string, unknown> = {};
      try {
        const [provider, id] = (process.env.PI_COMPACTION_PROBE_MODEL ?? '').split('/');
        const model = ctx.modelRegistry.find(provider, id);
        if (!model) throw new Error(`fixture model ${process.env.PI_COMPACTION_PROBE_MODEL} is not registered`);
        report.modelSet = await pi.setModel(model);
        const level = process.env.PI_COMPACTION_PROBE_THINKING;
        if (level) pi.setThinkingLevel(level as never);

        const reloads = Number(process.env.PI_COMPACTION_PROBE_RELOADS ?? 0);
        for (let round = 0; round < reloads; round++) await ctx.reload();
        report.reloads = reloads;

        const rounds = Number(process.env.PI_COMPACTION_PROBE_ROUNDS ?? 1);
        const compactions: unknown[] = [];
        for (let round = 0; round < rounds; round++) {
          if (round > 0) {
            // `waitForIdle()` can observe an idle agent before a fire-and-forget send has started,
            // so the turn is awaited through its own settlement event.
            const settled = new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 60_000);
              timer.unref?.();
              const off = pi.on('agent_settled', () => {
                clearTimeout(timer);
                off();
                resolve();
              });
            });
            pi.sendUserMessage(`probe follow-up ${round}`);
            await settled;
          }
          compactions.push(await compactOnce(ctx));
        }
        report.compactions = compactions;
        report.systemPromptTokens = Math.ceil(ctx.getSystemPrompt().length / 4);
        report.activeTools = pi.getActiveTools();
        report.entries = ctx.sessionManager.getEntries().map((entry) => {
          const base: Record<string, unknown> = { type: entry.type, id: entry.id };
          if (entry.type === 'message') {
            base.role = entry.message.role;
            base.text = textOf((entry.message as { content?: unknown }).content);
          }
          if (entry.type === 'compaction') {
            base.summary = entry.summary;
            base.firstKeptEntryId = entry.firstKeptEntryId;
            base.tokensBefore = entry.tokensBefore;
            base.fromHook = entry.fromHook ?? false;
            base.details = entry.details;
          }
          return base;
        });
        report.projection = describeProjection(ctx);
      } catch (error) {
        report.error = String(error);
      }
      writeFileSync(destination, JSON.stringify(report, null, 2));
      ctx.shutdown();
    },
  });
}

function compactOnce(ctx: ExtensionCommandContext): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'compaction did not settle' }), 120_000);
    timer.unref?.();
    const settle = (value: unknown) => {
      clearTimeout(timer);
      resolve(value);
    };
    ctx.compact({
      onComplete: (result) => settle({
        ok: true,
        summary: result.summary,
        summaryTokens: Math.ceil(result.summary.length / 4),
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        details: result.details,
      }),
      onError: (error) => settle({ ok: false, error: String(error) }),
    });
  });
}

function describeProjection(ctx: ExtensionCommandContext) {
  const projection = ctx.sessionManager.buildSessionProjection();
  const entries = projection.entries.map((entry) => ({
    id: entry.sourceEntry.id,
    type: entry.sourceEntry.type,
    tokens: entry.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
    roles: entry.messages.map((message) => message.role),
    text: entry.messages.map((message) => textOf((message as { content?: unknown }).content)).join('\n'),
  }));
  const tokens = (role: string) =>
    projection.messages.filter((message) => message.role === role).reduce((sum, message) => sum + estimateTokens(message), 0);
  return {
    entries,
    systemTokens: tokens('system'),
    compactionSummaryTokens: tokens('compactionSummary'),
    totalTokens: projection.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
    systemPromptChars: projection.messages
      .filter((message) => message.role === 'system')
      .reduce((sum, message) => sum + textOf((message as { content?: unknown }).content).length, 0),
  };
}

export type { Text };
