import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { Container } from '@earendil-works/pi-tui';
import { ToolExecutionComponent, UserMessageComponent, AssistantMessageComponent, InteractiveMode, createBashToolDefinition, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

let capturedInteractiveMode: InteractiveMode | undefined;
const origRenderInit = InteractiveMode.prototype.renderInitialMessages;
InteractiveMode.prototype.renderInitialMessages = function(this: InteractiveMode) {
  capturedInteractiveMode = this;
  return origRenderInit.call(this);
};

export default function probe(pi: ExtensionAPI) {
  const baseline = Container.prototype.render;
  const fingerprints = [Container.prototype.render, Container.prototype.handleMouse, InteractiveMode.prototype.setToolsExpanded, InteractiveMode.prototype.showStatus].map(method => createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex'));
  const key = Symbol.for('pi-minimal-display/cli-probe');
  const store = globalThis as typeof globalThis & { [key]?: { round: number; baseline: typeof baseline } };
  const run = store[key] ??= { round: 0, baseline };
  const restored = baseline === run.baseline;
  pi.registerCommand('display-probe', {
    description: 'Isolated test harness; not included in the published package',
    handler: async (_args, ctx) => {
      const destination = process.env.PI_DISPLAY_PROBE_RESULT;
      if (!destination) throw new Error('PI_DISPLAY_PROBE_RESULT is required');
      try {
        assert.ok(ctx.hasUI);
        assert.ok(restored, 'previous runtime patch was not restored before reload');
        assert.notEqual(Container.prototype.render, baseline);
        assert.equal(ctx.ui.getToolsExpanded(), run.round % 2 === 1, 'startup is minimal; reload preserves the previous global state');
        const definition = createBashToolDefinition(ctx.cwd);
        const transcript = new Container();
        transcript.addChild(new UserMessageComponent('synthetic fixture input'));
        const result = await definition.execute('fixture', { command: 'printf "probe-output"' }, undefined, undefined, ctx);
        const calls = ['first', 'second'].map(id => {
          const call = new ToolExecutionComponent('bash', id, { command: 'printf "probe-output"' }, {}, definition, { requestRender() {} } as never, ctx.cwd);
          call.updateResult({ ...result, isError: false });
          transcript.addChild(call);
          return call;
        });
        const collapsed = transcript.render(80).join('\n');
        assert.match(collapsed, /bash ×2/);
        assert.doesNotMatch(collapsed, /probe-output/);
        for (const call of calls) call.setExpanded(true);
        assert.match(transcript.render(80).join('\n'), /probe-output/);
        assert.doesNotMatch(transcript.render(80).join('\n'), /Retained data/);
        const message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden thinking' }, { type: 'text', text: 'visible text' }], stopReason: 'stop' } as const;
        const component = new AssistantMessageComponent(message as never);
        assert.match(component.render(80).join('\n'), /hidden thinking/);
        const hidden = new AssistantMessageComponent(message as never, true);
        assert.doesNotMatch(hidden.render(80).join('\n'), /hidden thinking|Thinking\.\.\./);
        assert.match(hidden.render(80).join('\n'), /visible text/);

        const failGroup = new Container();
        failGroup.addChild(new UserMessageComponent('failure turn'));
        const callA = new ToolExecutionComponent('bash', 'fa', { command: 'echo ok' }, {}, definition, { requestRender() {} } as never, ctx.cwd);
        callA.updateResult({ ...result, isError: false });
        failGroup.addChild(callA);
        const callB = new ToolExecutionComponent('bash', 'fb', { command: 'false' }, {}, definition, { requestRender() {} } as never, ctx.cwd);
        callB.updateResult({ ...result, isError: true });
        failGroup.addChild(callB);
        const failOutput = failGroup.render(80).join('\n');
        assert.match(stripVTControlCharacters(failOutput), /completed · 1 failed: bash/);
        assert.match(failOutput, /48;2;72;60;42/); // Dark amber failure card background

        if (capturedInteractiveMode) {
          const errMessage = { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'CLI retry failure 429' };
          const errComp = new AssistantMessageComponent(errMessage as never);
          capturedInteractiveMode.chatContainer.addChild(errComp);
          await capturedInteractiveMode.handleEvent({ type: 'message_end', message: errMessage } as never);
          await capturedInteractiveMode.handleEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 0, errorMessage: 'CLI retry failure 429' } as never);
          const cliFolded = stripVTControlCharacters(capturedInteractiveMode.chatContainer.render(80).join('\n'));
          assert.match(cliFolded, /model request · 1 error/);
          assert.doesNotMatch(cliFolded, /CLI retry failure 429/);
          await capturedInteractiveMode.handleEvent({ type: 'auto_retry_end', success: true, attempt: 1 } as never);
          const cliResumed = stripVTControlCharacters(capturedInteractiveMode.chatContainer.render(80).join('\n'));
          assert.match(cliResumed, /model request · resumed · 1 error/);
        }

        const reloads = Number(process.env.PI_DISPLAY_PROBE_RELOADS ?? 0);
        if (run.round < reloads) {
          run.round++;
          ctx.ui.setToolsExpanded(run.round % 2 === 1);
          await ctx.reload();
          process.stdout.write('\nPI_DISPLAY_PROBE_READY\n');
          return;
        }
        writeFileSync(destination, JSON.stringify({ passed: true, fingerprints, reloads: run.round, groupedCalls: calls.length, execution: result.content, collapsed }));
      } catch (error) {
        writeFileSync(destination, JSON.stringify({ passed: false, error: String(error) }));
      }
      ctx.shutdown();
    },
  });
}
