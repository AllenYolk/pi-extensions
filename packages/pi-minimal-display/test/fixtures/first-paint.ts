import { InteractiveMode, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Test-only injection into the real CLI's initial transcript lifecycle; no provider or tool execution.
export default function firstPaint(pi: ExtensionAPI) {
  if (process.env.PI_FIRST_PAINT_SCENARIO !== 'fresh') return;
  const proto = InteractiveMode.prototype;
  const original = proto.renderInitialMessages;
  const message = JSON.parse(process.env.PI_FIRST_PAINT_MESSAGE!);
  const initial = async function(this: InteractiveMode) {
    original.call(this);
    await this.handleEvent({ type: 'message_start', message });
    await this.handleEvent({ type: 'message_update', message });
    for (const call of message.content) {
      await this.handleEvent({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result: { content: [{ type: 'text', text: 'FIRST_PAINT_RAW_OUTPUT' }] }, isError: false });
    }
    await this.handleEvent({ type: 'message_end', message });
  };
  proto.renderInitialMessages = initial;
  pi.on('session_shutdown', () => { if (proto.renderInitialMessages === initial) proto.renderInitialMessages = original; });
}
