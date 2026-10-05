import { performance } from 'node:perf_hooks';
import { platform, arch } from 'node:os';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { loadConfig } from '../dist/config.js';
import { installPresentation } from '../dist/presentation.js';

Pi.initTheme('dark');
const transcript = new Tui.Container();
const session = Pi.SessionManager.inMemory(process.cwd());
const calls = [];
let source = 'synthetic: 40 turns, 8 calls/turn, 12 output lines/call';
if (process.argv[2]) {
  const input = readFileSync(process.argv[2], 'utf8');
  source = `recorded sha256:${createHash('sha256').update(input).digest('hex')}`;
  // Replay the public linear fixture in memory; never migrate or write its original file.
  for (const entry of input.trim().split('\n').map(JSON.parse)) if (entry.type === 'message') session.appendMessage(entry.message);
} else {
  for (let turn = 0; turn < 40; turn++) {
    session.appendMessage({ role: 'user', content: `Synthetic user turn ${turn}`, timestamp: turn });
    for (let call = 0; call < 8; call++) {
      session.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: `${turn}-${call}`, name: 'bash', arguments: { command: `echo fixture-${call}` } }], timestamp: turn });
      session.appendMessage({ role: 'toolResult', toolCallId: `${turn}-${call}`, toolName: 'bash', content: [{ type: 'text', text: Array.from({ length: 12 }, (_, line) => `fixture output line ${line}`).join('\n') }], isError: false, timestamp: turn });
    }
  }
}
const definitions = Object.fromEntries([Pi.createBashToolDefinition, Pi.createReadToolDefinition, Pi.createEditToolDefinition, Pi.createWriteToolDefinition].map(factory => { const definition = factory(process.cwd()); return [definition.name, definition]; }));
const byId = new Map();
for (const entry of session.getBranch()) {
  const message = entry.message;
  if (message?.role === 'user') {
    const text = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (text) transcript.addChild(new Pi.UserMessageComponent(text));
  } else if (message?.role === 'assistant') {
    transcript.addChild(new Pi.AssistantMessageComponent(message));
    for (const block of message.content) if (block.type === 'toolCall') {
      const component = new Pi.ToolExecutionComponent(block.name, block.id, block.arguments, {}, definitions[block.name], { requestRender() {} }, process.cwd());
      transcript.addChild(component);
      calls.push(component);
      byId.set(block.id, component);
    }
  } else if (message?.role === 'toolResult') {
    byId.get(message.toolCallId)?.updateResult(message);
  }
}
function sample(expanded) {
  calls.forEach(call => call.setExpanded(expanded));
  const times = [];
  let lines;
  for (let iteration = 0; iteration < 9; iteration++) {
    const start = performance.now();
    lines = transcript.render(100);
    if (iteration >= 2) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { medianMs: Number(times[3].toFixed(3)), displayLines: lines.length };
}
const native = { collapsed: sample(false), expanded: sample(true) };
const dispose = installPresentation(loadConfig('work/missing').config, Pi.VERSION, console.error, { pi: Pi, tui: Tui, ui: { get theme() { return theme; } }, session });
assert.equal(typeof dispose, 'function');
try {
  const compact = { collapsed: sample(false), expanded: sample(true) };
  console.log(JSON.stringify({ node: process.version, pi: Pi.VERSION, platform: `${platform()}-${arch()}`, workload: { source, sessionEntries: session.getBranch().length, toolCalls: calls.length, width: 100, samples: 7 }, native, compact }, null, 2));
} finally { dispose(); }
