import { writeFileSync } from 'node:fs';
import { estimateTokens, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Drives real turns through the running CLI so the prune path runs at a turn boundary, and reports
 * what the session ended up with. No model and no network: the fake provider answers in process.
 *
 * `PI_COMPACTION_PRUNE_RESULT`   file the report is written to
 * `PI_COMPACTION_PRUNE_MODEL`    `provider/model` the session runs on
 * `PI_COMPACTION_PRUNE_MESSAGES` user messages to send, one turn each (default 2)
 * `PI_COMPACTION_PRUNE_RELOADS`  `/reload` cycles before the run
 */

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return '';
      const record = block as Record<string, unknown>;
      if (record.type === 'text' || record.type === 'thinking') return String(record.text ?? record.thinking ?? '');
      if (record.type === 'toolCall') return `TOOLCALL ${String(record.name)} ${String(record.id)} ${JSON.stringify(record.arguments)}`;
      return '';
    })
    .join('\n');
};

export default function probe(pi: ExtensionAPI) {
  // A reload replaces the runner, so the marker is written from an event rather than from the
  // command: it is what the PTY driver waits for before sending the next step.
  pi.on('session_start', () => {
    process.stdout.write('\nPI_COMPACTION_PRUNE_READY\n');
  });

  pi.registerCommand('prune-probe', {
    description: 'pi-compaction test harness; not part of any published package',
    handler: async (_args, ctx) => {
      const destination = process.env.PI_COMPACTION_PRUNE_RESULT;
      if (!destination) throw new Error('PI_COMPACTION_PRUNE_RESULT is required');
      const report: Record<string, unknown> = {};
      try {
        const [provider, id] = (process.env.PI_COMPACTION_PRUNE_MODEL ?? '').split('/');
        const model = ctx.modelRegistry.find(provider, id);
        if (!model) throw new Error(`fixture model ${process.env.PI_COMPACTION_PRUNE_MODEL} is not registered`);
        report.modelSet = await pi.setModel(model);
        report.reloads = Number(process.env.PI_COMPACTION_PRUNE_RELOADS ?? 0);

        const messages = Number(process.env.PI_COMPACTION_PRUNE_MESSAGES ?? 2);
        for (let index = 0; index < messages; index++) await send(pi, `probe turn ${index}`);

        report.contextUsage = ctx.getContextUsage();
        report.entries = ctx.sessionManager.getEntries().map((entry) => {
          const base: Record<string, unknown> = { type: entry.type, id: entry.id, parentId: entry.parentId };
          if (entry.type === 'message') {
            base.role = entry.message.role;
            base.text = textOf((entry.message as { content?: unknown }).content);
            const result = entry.message as { toolName?: string; toolCallId?: string };
            if (result.toolName) base.toolName = result.toolName;
            if (result.toolCallId) base.toolCallId = result.toolCallId;
          }
          if (entry.type === 'context_edit') {
            base.targetId = entry.targetId;
            // A replacement, never an omission: null would remove the result and orphan its call.
            base.isReplacement = entry.replacement !== null;
            base.text = entry.replacement === null ? '' : textOf(entry.replacement.content);
          }
          return base;
        });

        const projection = ctx.sessionManager.buildSessionProjection();
        report.projection = projection.entries.map((entry) => ({
          id: entry.sourceEntry.id,
          type: entry.sourceEntry.type,
          roles: entry.messages.map((message) => message.role),
          tokens: entry.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
          text: entry.messages.map((message) => textOf((message as { content?: unknown }).content)).join('\n'),
        }));
        // Every tool call the model will see must still have its result, pruned or not.
        report.toolCallIds = projection.messages.flatMap((message) =>
          message.role === 'assistant' && Array.isArray(message.content)
            ? message.content.filter((block) => block.type === 'toolCall').map((block) => block.id)
            : []);
        report.toolResultIds = projection.messages
          .filter((message) => message.role === 'toolResult')
          .map((message) => (message as { toolCallId: string }).toolCallId);
        report.commands = pi.getCommands().map((command) => ({ name: command.name, source: command.source }));
      } catch (error) {
        report.error = String(error);
      }
      writeFileSync(destination, JSON.stringify(report, null, 2));
      ctx.shutdown();
    },
  });
}

/**
 * `waitForIdle()` can observe an idle agent before a fire-and-forget send has started, so the turn
 * is awaited through its own settlement event.
 */
function send(pi: ExtensionAPI, text: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 60_000);
    timer.unref?.();
    const off = pi.on('agent_settled', () => {
      clearTimeout(timer);
      off();
      resolve();
    });
    pi.sendUserMessage(text);
  });
}
