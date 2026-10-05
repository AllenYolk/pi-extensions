import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import * as Pi from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../../dist/config.js';
import { installPresentation } from '../../dist/presentation.js';

// Pi can carry its own Tui dependency; use the same classes InteractiveMode uses.
const requirePi = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const Tui = await import(pathToFileURL(requirePi.resolve('@earendil-works/pi-tui')).href);
const profile = process.env.PI_CODING_AGENT_DIR;
assert.equal(profile, process.cwd());
assert.equal(Pi.getAgentDir(), profile);
assert.equal(process.env.PI_OFFLINE, '1');
const expandKey = process.env.PI_HOST_EXPAND_KEY ?? 'ctrl+o';
const expandInput = expandKey === 'ctrl+g' ? '\x07' : '\x0f';
writeFileSync(join(profile, 'keybindings.json'), JSON.stringify({ 'app.tools.expand': expandKey }));

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const image = { type: 'image', data: png, mimeType: 'image/png' };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = content => ({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'host-fixture', content, usage, stopReason: 'toolUse', timestamp: 1 });
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const user = content => ({ role: 'user', content, timestamp: 1 });
const result = (id, name, content, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: name, content, isError, timestamp: 1 });
const text = value => ({ type: 'text', text: value });
let manager = Pi.SessionManager.create(profile, join(profile, 'sessions'));
manager.appendMessage(user('Replay first turn'));
manager.appendMessage(assistant([
  { type: 'thinking', thinking: 'REPLAY THINKING' },
  call('replay-bash', 'bash', { command: 'printf REPLAY_OUTPUT' }),
  call('replay-image', 'read', { path: join(profile, 'fixture.png') }),
]));
manager.appendMessage(result('replay-bash', 'bash', [text('REPLAY_OUTPUT\nSECOND BLOCK')]));
const firstTurnLeaf = manager.appendMessage(result('replay-image', 'read', [text('RETAINED IMAGE'), image]));
manager.appendMessage(user([image]));
manager.appendMessage(assistant([call('second-turn', 'bash', { command: 'printf SECOND_TURN' })]));
manager.appendMessage(result('second-turn', 'bash', [text('SECOND_TURN')]));
// Reopen the saved JSONL, rather than replaying only hand-constructed components.
manager = Pi.SessionManager.open(manager.getSessionFile());

const services = await Pi.createAgentSessionServices({
  cwd: profile, agentDir: profile,
  settingsManager: Pi.SettingsManager.inMemory({ showImages: true, hideThinkingBlock: false, showCacheMissNotices: false, showTerminalProgress: false }),
  resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
});
assert.deepEqual(services.diagnostics, []);
const created = await Pi.createAgentSessionFromServices({ services, sessionManager: manager });
const runtime = new Pi.AgentSessionRuntime(created.session, services, async () => { throw new Error('Unexpected runtime replacement'); });
Pi.initTheme('dark');
const mode = new Pi.InteractiveMode(runtime, { tuiMode: 'regular' });
assert.ok(mode.chatContainer instanceof Tui.Container);
// Exercise the host's methods without starting raw terminal input or a provider loop.
mode.ui.stop();
mode.isInitialized = true;
mode.setupKeyHandlers();
const capabilities = Tui.getCapabilities();
Tui.setCapabilities({ ...capabilities, images: 'iterm2' });
const render = () => mode.chatContainer.render(100).join('\n');
const images = output => output.match(/\x1b\]1337;File=[^\x07]*\x07/g) ?? [];
const snapshot = () => JSON.stringify({ entries: manager.getEntries(), context: manager.buildSessionContext(), messages: runtime.session.messages });
const diagnostics = [];
let dispose;
try {
  mode.renderSessionEntries(manager.buildContextEntries(), { populateHistory: true });
  assert.ok(mode.chatContainer.children.some(child => child instanceof Pi.ToolExecutionComponent));
  mode.defaultEditor.handleInput(expandInput);
  const native = render();
  const nativeImages = images(native);
  assert.equal(nativeImages.length, 1, 'native replay must emit one iTerm2 image');
  assert.ok(nativeImages[0].includes(png));
  assert.match(native, /REPLAY THINKING/);
  mode.defaultEditor.handleInput(expandInput);
  mode.rebuildChatFromMessages();
  const before = snapshot();
  dispose = installPresentation(loadConfig(profile).config, Pi.VERSION, message => diagnostics.push(message), { pi: Pi, tui: Tui, ui: mode.createExtensionUIContext(), session: manager });
  assert.equal(typeof dispose, 'function', diagnostics.join('\n'));
  const collapsed = render();
  assert.ok(collapsed.includes(expandKey));
  if (expandKey === 'ctrl+g') {
    mode.defaultEditor.handleInput('\x0f');
    assert.equal(render(), collapsed, 'old binding must not switch display mode');
  }
  assert.match(collapsed, /bash ×1 read ×1/);
  assert.equal((collapsed.match(/bash ×1/g) ?? []).length, 2, 'image-only user arrival separates turns');
  assert.match(collapsed, /REPLAY THINKING/);
  assert.doesNotMatch(collapsed, /REPLAY_OUTPUT|SECOND_TURN/);
  assert.deepEqual(images(collapsed), []);
  mode.hideThinkingBlock = true;
  mode.updateThinkingBlockVisibility();
  assert.doesNotMatch(render(), /REPLAY THINKING|Thinking\.\.\./);
  mode.hideThinkingBlock = false;
  mode.updateThinkingBlockVisibility();
  assert.match(render(), /REPLAY THINKING/);
  mode.defaultEditor.handleInput('\x14');
  assert.equal(mode.hideThinkingBlock, true);
  assert.equal(mode.settingsManager.getHideThinkingBlock(), true);
  assert.doesNotMatch(render(), /REPLAY THINKING|Thinking\.\.\./);
  assert.doesNotMatch(render(), /Thinking blocks: (?:hidden|visible)/, 'thinking toggle status must stay out of the transcript');
  mode.defaultEditor.handleInput('\x14');
  assert.equal(mode.hideThinkingBlock, false);
  assert.equal(mode.settingsManager.getHideThinkingBlock(), false);
  assert.match(render(), /REPLAY THINKING/);
  assert.doesNotMatch(render(), /Thinking blocks: (?:hidden|visible)/, 'both thinking toggle directions must stay silent');
  mode.defaultEditor.handleInput(expandInput);
  const expanded = render();
  assert.doesNotMatch(expanded, /Tool output: (?:expanded|collapsed)/);
  assert.equal(Object.hasOwn(mode, 'showStatus'), false);
  assert.doesNotMatch(expanded, /Retained data/);
  assert.match(expanded, /REPLAY_OUTPUT/);
  assert.match(expanded, /RETAINED IMAGE/);
  assert.deepEqual(images(expanded), nativeImages, 'expanded rendering must preserve the native image protocol payload');
  assert.equal(snapshot(), before, 'rendering and key dispatch must not change saved/model data');

  mode.defaultEditor.handleInput(expandInput);
  assert.doesNotMatch(render(), /Tool output: (?:expanded|collapsed)/);
  const lines = mode.chatContainer.render(100);
  const y = lines.findIndex(line => line.includes('bash ×1 read ×1'));
  assert.ok(y >= 0);
  assert.equal(mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 100, height: lines.length })?.handled, true);
  assert.deepEqual(images(render()), nativeImages, 'mouse expansion must expose the retained image');
  mode.defaultEditor.handleInput(expandInput);
  assert.match(render(), /SECOND_TURN/, 'global expansion includes groups not opened by the mouse');
  mode.defaultEditor.handleInput(expandInput);
  assert.doesNotMatch(render(), /REPLAY_OUTPUT|SECOND_TURN/);
  assert.doesNotMatch(render(), /Tool output: (?:expanded|collapsed)/);
  await mode.handleEvent({ type: 'tool_execution_start', toolCallId: 'after-toggle', toolName: 'readSeek_grep', args: { pattern: 'fixture' } });
  await mode.handleEvent({ type: 'tool_execution_end', toolCallId: 'after-toggle', toolName: 'readSeek_grep', result: { content: [text('AFTER_TOGGLE')] }, isError: false });
  assert.match(render(), /bash ×1 readSeek_grep ×1/, 'toggle status must not split adjacent tool activity');
  mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 100, height: mode.chatContainer.render(100).length });
  const nativeLines = mode.chatContainer.render(100);
  const nativeY = nativeLines.findIndex(line => line.includes('printf REPLAY_OUTPUT'));
  assert.ok(nativeY >= 0);
  assert.equal(mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y: nativeY, screenX: 2, screenY: nativeY, width: 100, height: nativeLines.length })?.handled, true);
  assert.match(render(), /bash ×1 read ×1/);
  assert.deepEqual(images(render()), [], 'native mouse collapse must collapse the entire group');
  assert.equal(snapshot(), before);

  manager.branch(firstTurnLeaf);
  mode.rebuildChatFromMessages();
  assert.doesNotMatch(render(), /SECOND_TURN/);
  assert.equal((render().match(/bash ×1/g) ?? []).length, 1);
  const forkFile = manager.createBranchedSession(firstTurnLeaf);
  assert.ok(forkFile);
  assert.deepEqual(Pi.SessionManager.open(forkFile).buildSessionContext().messages, manager.buildSessionContext().messages);
  mode.rebuildChatFromMessages();
  assert.match(render(), /bash ×1 read ×1/);

  const between = assistant([text('BETWEEN_HOST_CALLS'), call('after-commentary', 'bash', { command: 'printf AFTER_HOST_RESULT' })]);
  manager.appendMessage(between);
  await mode.handleEvent({ type: 'message_start', message: between });
  await mode.handleEvent({ type: 'message_update', message: between });
  await mode.handleEvent({ type: 'message_end', message: between });
  const afterCommentary = result('after-commentary', 'bash', [text('AFTER_HOST_RESULT')]);
  manager.appendMessage(afterCommentary);
  await mode.handleEvent({ type: 'tool_execution_end', toolCallId: 'after-commentary', toolName: 'bash', result: afterCommentary, isError: false });
  assert.match(render(), /bash ×1 read ×1[\s\S]*BETWEEN_HOST_CALLS[\s\S]*bash ×1/);
  mode.defaultEditor.handleInput(expandInput);
  assert.match(render(), /REPLAY_OUTPUT[\s\S]*BETWEEN_HOST_CALLS[\s\S]*AFTER_HOST_RESULT/);
  mode.defaultEditor.handleInput(expandInput);

  mode.subscribeToAgent();
  await runtime.session.followUp('Live next turn');
  assert.match(mode.pendingMessagesContainer.render(100).join('\n'), /Follow-up: Live next turn/);
  const queued = mode.getAllQueuedMessages();
  render();
  assert.deepEqual(mode.getAllQueuedMessages(), queued, 'transcript rendering must not consume queued input');
  assert.deepEqual(mode.clearAllQueues().followUp, ['Live next turn']);
  const arriving = user('Live next turn');
  manager.appendMessage(arriving);
  await mode.handleEvent({ type: 'message_start', message: arriving });
  const streaming = assistant([{ type: 'thinking', thinking: 'LIVE THINKING' }, text('LIVE COMMENTARY')]);
  await mode.handleEvent({ type: 'message_start', message: streaming });
  const pending = { ...streaming, content: [...streaming.content, call('live-failure', 'bash', { command: 'false' }), call('live-pending', 'bash', { command: 'printf PARTIAL' })] };
  const pendingBefore = JSON.stringify(pending);
  await mode.handleEvent({ type: 'message_update', message: pending, assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 2, delta: '', partial: pending } });
  assert.equal(mode.streamingComponent.isStreaming, true);
  assert.equal(JSON.stringify(pending), pendingBefore);
  assert.match(render(), /LIVE COMMENTARY/);
  assert.match(render(), /LIVE THINKING/);
  assert.match(render(), /bash ×2[\s\S]*2 pending/);
  for (const id of ['live-failure', 'live-pending']) {
    await mode.handleEvent({ type: 'tool_execution_start', toolCallId: id, toolName: 'bash', args: { command: 'fixture' } });
  }
  await mode.handleEvent({ type: 'tool_execution_update', toolCallId: 'live-pending', toolName: 'bash', partialResult: { content: [text('LIVE_PARTIAL_RESULT')] } });
  mode.defaultEditor.handleInput(expandInput);
  assert.match(render(), /LIVE_PARTIAL_RESULT/);
  mode.defaultEditor.handleInput(expandInput);
  await mode.handleEvent({ type: 'tool_execution_end', toolCallId: 'live-failure', toolName: 'bash', result: { content: [text('FAILURE DETAIL')] }, isError: true });
  assert.match(render(), /bash ×2[\s\S]*failed: bash; 1 pending/);
  const aborted = { ...pending, stopReason: 'aborted' };
  await mode.handleEvent({ type: 'message_end', message: aborted });
  assert.match(render(), /bash ×2[\s\S]*failed: bash/);
  assert.doesNotMatch(render(), /\d+ pending/);
  mode.defaultEditor.handleInput(expandInput);
  assert.match(render(), /FAILURE DETAIL/);
  assert.match(render(), /Operation aborted/);
  const statusRelay = { render: () => [], invalidate() {}, setExpanded() { mode.showStatus('UNRELATED STATUS'); } };
  mode.chatContainer.children.unshift(statusRelay);
  mode.defaultEditor.handleInput(expandInput);
  assert.match(render(), /UNRELATED STATUS/, 'other status calls during expansion remain visible');
  assert.doesNotMatch(render(), /Tool output: (?:expanded|collapsed)/);
  mode.chatContainer.removeChild(statusRelay);
  assert.equal(Object.hasOwn(mode, 'showStatus'), false);
  mode.showStatus('Tool output: expanded');
  assert.match(render(), /Tool output: expanded/, 'identical status text outside the native toggle remains visible');
  const originalStatus = mode.showStatus;
  const failure = { render: () => [], invalidate() {}, setExpanded() { throw new Error('forced expansion failure'); } };
  mode.chatContainer.children.unshift(failure);
  assert.throws(() => mode.setToolsExpanded(!mode.toolOutputExpanded), /forced expansion failure/);
  assert.equal(mode.showStatus, originalStatus);
  assert.equal(Object.hasOwn(mode, 'showStatus'), false, 'temporary status routing is restored after failure');
  mode.chatContainer.removeChild(failure);
  let escapedStatus;
  const escape = { render: () => [], invalidate() {}, setExpanded() {
    if (escapedStatus) return;
    const captured = mode.showStatus;
    escapedStatus = function(message) { return captured.call(this, message); };
    Object.defineProperty(mode, 'showStatus', { value: escapedStatus, configurable: true, writable: true });
  } };
  mode.chatContainer.children.unshift(escape);
  mode.setToolsExpanded(!mode.toolOutputExpanded);
  mode.chatContainer.removeChild(escape);
  mode.showStatus('Tool output: collapsed');
  assert.match(render(), /Tool output: collapsed/, 'an escaped temporary filter expires when the action returns');
  dispose();
  mode.showStatus('Tool output: expanded');
  assert.match(render(), /Tool output: expanded/, 'a later wrapper cannot keep filtering after disposal');
  delete mode.showStatus;
  assert.match(render(), /REPLAY THINKING/);
  assert.match(render(), /LIVE THINKING/);
  assert.deepEqual(diagnostics, []);
  process.stdout.write('HOST_PROBE_OK\n');
} finally {
  dispose?.();
  Tui.setCapabilities(capabilities);
  mode.isInitialized = false;
  mode.stop();
  await runtime.dispose();
}
