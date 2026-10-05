import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Container, Text, MouseRegion, visibleWidth } from '@earendil-works/pi-tui';
import { ToolExecutionComponent, UserMessageComponent, AssistantMessageComponent, SkillInvocationMessageComponent, createBashToolDefinition, initTheme } from '@earendil-works/pi-coding-agent';
import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { installPresentation as install } from '../dist/presentation.js';
import { loadConfig } from '../dist/config.js';
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { stripVTControlCharacters } from 'node:util';

initTheme('dark');
const config = loadConfig('work/missing-profile').config;
config.tools.custom = 'native';
const ui = { requestRender() {}, get theme() { return theme; } };
const bash = createBashToolDefinition(process.cwd());
const installPresentation = (settings, version, report) => install(settings, version, report, { pi: Pi, tui: Tui, ui });
function tool(name, id, text, definition = bash) {
  const component = new ToolExecutionComponent(name, id, { command: `echo ${id}` }, {}, definition, ui, process.cwd());
  component.updateResult({ content: [{ type: 'text', text }], isError: false });
  return component;
}

test('summary cards use native padding, theme and separate count/status lines', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    transcript.addChild(tool('readSeek_edit', 'edit', 'hidden'));
    const output = transcript.render(100);
    assert.equal(output.length, 5);
    assert.equal(output[0], '');
    assert.equal(stripVTControlCharacters(output[1]), ' '.repeat(100));
    assert.equal(stripVTControlCharacters(output[2]).trim(), 'readSeek_edit ×1');
    assert.match(stripVTControlCharacters(output[3]), /succeeded.*to expand/);
    assert.equal(stripVTControlCharacters(output[4]), ' '.repeat(100));
    assert.ok(output[2].includes(theme.bold('readSeek_edit ×1')));
    assert.equal(output[1], theme.bg('toolSuccessBg', ' '.repeat(100)));
  } finally { dispose(); }
});

test('card colors follow current dark/light themes and failures win over pending work', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const first = tool('bash', 'first', 'hidden');
    const second = tool('readSeek_grep', 'second', 'hidden');
    transcript.children.push(first, second);
    for (const name of ['dark', 'light']) {
      initTheme(name);
      first.updateResult({ content: [], isError: false });
      second.updateResult({ content: [], isError: false });
      assert.equal(transcript.render(80)[1], theme.bg('toolSuccessBg', ' '.repeat(80)));
      second.updateResult({ content: [], isError: false }, true);
      assert.equal(transcript.render(80)[1], theme.bg('toolPendingBg', ' '.repeat(80)));
      first.updateResult({ content: [], isError: true });
      assert.equal(transcript.render(80)[1], theme.bg('toolErrorBg', ' '.repeat(80)));
      const narrow = transcript.render(20);
      assert.ok(narrow.every(line => visibleWidth(line) <= 20));
      const text = narrow.map(stripVTControlCharacters).join(' ').replace(/\s+/g, ' ');
      assert.match(text, /failed: bash/);
      assert.match(text, /1 pending/);
    }
  } finally { dispose(); initTheme('dark'); }
});

test('ordinary registered names compact without guessing labels and interactive tools stay native', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    for (const name of ['bash', 'edit', 'grep', 'readSeek_edit', 'readSeek_grep', 'future_tool']) transcript.addChild(tool(name, name, 'HIDDEN ORDINARY RESULT'));
    for (const name of ['ask_user_question', 'plan_mode_question', 'plan_mode_complete', 'custom']) transcript.addChild(tool(name, name, `VISIBLE_${name}`));
    const text = stripVTControlCharacters(transcript.render(180).join('\n'));
    assert.match(text, /bash ×1 edit ×1 grep ×1 readSeek_edit ×1 readSeek_grep ×1 future_tool ×1/);
    assert.doesNotMatch(text, /HIDDEN ORDINARY RESULT/);
    for (const name of ['ask_user_question', 'plan_mode_question', 'plan_mode_complete', 'custom']) assert.match(text, new RegExp(`VISIBLE_${name}`));
  } finally { dispose(); }
});

test('all colored padding is clickable, the leading gap is not, including after resize', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const call = tool('readSeek_edit', 'padding', 'EXPANDED FROM PADDING');
    transcript.addChild(call);
    const event = { type: 'click', button: 'left', x: 0, y: 0, width: 80, height: 5 };
    transcript.render(80);
    assert.equal(transcript.handleMouse(event), undefined);
    assert.doesNotMatch(transcript.render(80).join('\n'), /EXPANDED FROM PADDING/);
    for (const width of [80, 20]) {
      for (const edge of ['top', 'bottom', 'left', 'right']) {
        call.setExpanded(false);
        const lines = transcript.render(width);
        const y = edge === 'top' ? 1 : edge === 'bottom' ? lines.length - 1 : 2;
        const x = edge === 'right' ? width - 1 : 0;
        assert.equal(transcript.handleMouse({ ...event, width, x, y })?.handled, true);
        assert.match(transcript.render(80).join('\n'), /EXPANDED FROM PADDING/);
      }
    }
  } finally { dispose(); }
});

test('a turn groups mixed calls, native expansion retains details, disposal restores the host', () => {
  const before = Container.prototype.render;
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  assert.equal(typeof dispose, 'function');
  try {
    const transcript = new Container();
    transcript.addChild(new UserMessageComponent('hello'));
    const first = tool('bash', 'first', 'FIRST RESULT');
    const second = tool('read', 'second', 'SECOND RESULT');
    transcript.addChild(first);
    transcript.addChild(second);
    const originalChildren = [...transcript.children];
    const collapsed = transcript.render(80).join('\n');
    assert.match(collapsed, /bash ×1 read ×1/);
    assert.doesNotMatch(collapsed, /FIRST RESULT|SECOND RESULT|echo first/);
    assert.deepEqual(transcript.children, originalChildren);
    first.setExpanded(true);
    second.setExpanded(true);
    const expanded = transcript.render(80).join('\n');
    assert.match(expanded, /FIRST RESULT/);
    assert.match(expanded, /SECOND RESULT/);
    dispose();
    first.setExpanded(false);
    second.setExpanded(false);
    assert.match(transcript.render(80).join('\n'), /echo first/);
  } finally { dispose(); }
  assert.equal(Container.prototype.render, before);
});

test('preexisting presentation-only wrappers are rejected without changing their owner', () => {
  const original = Container.prototype.render;
  function wrapper(width) { return original.call(this, width); }
  Container.prototype.render = wrapper;
  let dispose;
  try {
    const messages = [];
    dispose = installPresentation(config, Pi.VERSION, value => messages.push(value));
    assert.equal(dispose, undefined);
    assert.equal(Container.prototype.render, wrapper);
    assert.match(messages[0], /modified|conflict|incompatible/i);
  } finally { dispose?.(); Container.prototype.render = original; }
});

test('a preexisting expansion wrapper is rejected without changing its owner', () => {
  const original = Pi.InteractiveMode.prototype.setToolsExpanded;
  function wrapper(expanded) { return original.call(this, expanded); }
  Pi.InteractiveMode.prototype.setToolsExpanded = wrapper;
  try {
    const messages = [];
    assert.equal(installPresentation(config, Pi.VERSION, value => messages.push(value)), undefined);
    assert.equal(Pi.InteractiveMode.prototype.setToolsExpanded, wrapper);
    assert.match(messages[0], /modified|incompatible/i);
  } finally { Pi.InteractiveMode.prototype.setToolsExpanded = original; }
});

test('thinking visibility toggle is silent only during the native action and restores on failure', () => {
  const statuses = [];
  let fail = false;
  const settings = { value: false, setHideThinkingBlock(value) { this.value = value; } };
  const fake = {
    hideThinkingBlock: false,
    settingsManager: settings,
    updateThinkingBlockVisibility() {
      this.showStatus('UNRELATED STATUS');
      if (fail) throw new Error('thinking update failed');
    },
    showStatus(message) { statuses.push(message); },
  };
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    Pi.InteractiveMode.prototype.toggleThinkingBlockVisibility.call(fake);
    Pi.InteractiveMode.prototype.toggleThinkingBlockVisibility.call(fake);
    assert.equal(fake.hideThinkingBlock, false);
    assert.equal(settings.value, false);
    assert.deepEqual(statuses, ['UNRELATED STATUS', 'UNRELATED STATUS']);
    fake.showStatus('Thinking blocks: visible');
    assert.deepEqual(statuses, ['UNRELATED STATUS', 'UNRELATED STATUS', 'Thinking blocks: visible']);
    const originalStatus = fake.showStatus;
    fail = true;
    assert.throws(() => Pi.InteractiveMode.prototype.toggleThinkingBlockVisibility.call(fake), /thinking update failed/);
    assert.equal(fake.showStatus, originalStatus);
    assert.deepEqual(statuses, ['UNRELATED STATUS', 'UNRELATED STATUS', 'Thinking blocks: visible', 'UNRELATED STATUS']);
  } finally { dispose(); }
});

test('a preexisting Assistant wrapper is rejected without changing its owner', () => {
  const original = AssistantMessageComponent.prototype.updateContent;
  function wrapper(...args) { return original.apply(this, args); }
  AssistantMessageComponent.prototype.updateContent = wrapper;
  try {
    const messages = [];
    assert.equal(installPresentation(config, Pi.VERSION, value => messages.push(value)), undefined);
    assert.equal(AssistantMessageComponent.prototype.updateContent, wrapper);
    assert.match(messages[0], /modified|incompatible/i);
  } finally { AssistantMessageComponent.prototype.updateContent = original; }
});

test('five calls, commentary, then three calls retain their relative positions', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const calls = [];
    for (const [prefix, count] of [['BEFORE', 5], ['AFTER', 3]]) {
      if (prefix === 'AFTER') transcript.addChild(new AssistantMessageComponent({ role: 'assistant', content: [{ type: 'text', text: 'BETWEEN_COMMENTARY' }], stopReason: 'stop' }));
      for (let index = 0; index < count; index++) {
        transcript.addChild(new AssistantMessageComponent({ role: 'assistant', content: [{ type: 'toolCall', id: `${prefix}_${index}`, name: 'bash', arguments: {} }], stopReason: 'toolUse' }));
        const call = tool('bash', `${prefix}_${index}`, `RESULT_${prefix}_${index}`);
        calls.push(call);
        transcript.addChild(call);
      }
    }
    const source = [...transcript.children];
    const collapsed = transcript.render(100).join('\n');
    assert.match(collapsed, /bash ×5[\s\S]*BETWEEN_COMMENTARY[\s\S]*bash ×3/);
    for (const call of calls) call.setExpanded(true);
    const expanded = transcript.render(100).join('\n');
    assert.match(expanded, /RESULT_BEFORE_4[\s\S]*BETWEEN_COMMENTARY[\s\S]*RESULT_AFTER_0/);
    assert.deepEqual(transcript.children, source);
  } finally { dispose(); }
});

test('image-only user messages in the session split groups even without a visible user card', () => {
  const session = Pi.SessionManager.inMemory(process.cwd());
  session.appendMessage({ role: 'user', content: [{ type: 'image', data: 'fixture', mimeType: 'image/png' }], timestamp: 1 });
  session.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'bash', arguments: {} }], timestamp: 2 });
  session.appendMessage({ role: 'user', content: [{ type: 'image', data: 'fixture', mimeType: 'image/png' }], timestamp: 3 });
  session.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'b', name: 'bash', arguments: {} }], timestamp: 4 });
  const dispose = install(config, Pi.VERSION, () => {}, { pi: Pi, tui: Tui, ui, session });
  try {
    const transcript = new Container();
    transcript.addChild(tool('bash', 'a', 'A'));
    transcript.addChild(tool('bash', 'b', 'B'));
    const rendered = transcript.render(80).join('\n');
    assert.doesNotMatch(rendered, /bash ×2/);
    assert.equal((rendered.match(/bash ×1/g) ?? []).length, 2);
  } finally { dispose(); }
});

test('native hidden thinking is omitted and does not split groups', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const assistant = new AssistantMessageComponent(undefined, true);
    transcript.children.push(tool('bash', 'before', 'BEFORE'), assistant, tool('bash', 'after', 'AFTER'));
    assert.match(transcript.render(100).join('\n'), /bash ×2/);
    assistant.updateContent({ role: 'assistant', content: [{ type: 'thinking', thinking: 'HIDDEN NARRATIVE' }], stopReason: 'stop' }, true);
    let output = transcript.render(100).join('\n');
    assert.doesNotMatch(output, /HIDDEN NARRATIVE/);
    assert.doesNotMatch(output, /Thinking\.\.\./);
    assert.match(output, /bash ×2/);
    assistant.updateContent({ role: 'assistant', content: [{ type: 'thinking', thinking: 'HIDDEN NARRATIVE' }, { type: 'text', text: 'STREAMED NARRATIVE' }], stopReason: 'stop' }, true);
    output = transcript.render(100).join('\n');
    assert.doesNotMatch(output, /HIDDEN NARRATIVE|Thinking\.\.\./);
    assert.match(output, /bash ×1[\s\S]*STREAMED NARRATIVE[\s\S]*bash ×1/);
    assistant.setHideThinkingBlock(false);
    assistant.updateContent({ role: 'assistant', content: [{ type: 'thinking', thinking: 'VISIBLE NARRATIVE' }], stopReason: 'stop' }, true);
    assert.match(transcript.render(100).join('\n'), /bash ×1[\s\S]*VISIBLE NARRATIVE[\s\S]*bash ×1/);
    transcript.children[1] = tool('custom', 'native', 'NATIVE RESULT');
    assert.match(transcript.render(100).join('\n'), /bash ×1[\s\S]*NATIVE RESULT[\s\S]*bash ×1/);
    transcript.children[1] = new AssistantMessageComponent({ role: 'assistant', content: [], stopReason: 'length' });
    output = transcript.render(100).join('\n');
    assert.match(output, /bash ×1[\s\S]*Response was truncated[\s\S]*bash ×1/);
  } finally { dispose(); }
});

test('thinking omission follows native component state and disposal restores native output', () => {
  const message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'EARLIER THINKING' }], stopReason: 'stop' };
  const originalUpdate = AssistantMessageComponent.prototype.updateContent;
  const originalRender = AssistantMessageComponent.prototype.render;
  for (const hide of [false, true]) {
    const component = new AssistantMessageComponent(message, hide);
    const dispose = installPresentation(config, Pi.VERSION, () => {});
    try {
      const output = component.render(80).join('\n');
      if (hide) assert.doesNotMatch(output, /EARLIER THINKING|Thinking\.\.\./);
      else assert.match(output, /EARLIER THINKING/);
    } finally { dispose(); }
    assert.equal(AssistantMessageComponent.prototype.updateContent, originalUpdate);
    assert.equal(AssistantMessageComponent.prototype.render, originalRender);
    if (hide) assert.match(component.render(80).join('\n'), /Thinking\.\.\./);
  }
});

test('expanded tools match native output without duplicating raw data or changing results', () => {
  const transcript = new Container();
  const write = new ToolExecutionComponent('write', 'write', { path: 'fixture.txt', content: 'WRITTEN CONTENT' }, {}, Pi.createWriteToolDefinition(process.cwd()), ui, process.cwd());
  const result = { content: [{ type: 'text', text: 'WRITE SUCCESS TEXT' }, { type: 'text', text: 'SECOND TEXT BLOCK' }], details: { marker: 'RETAINED DETAILS' }, isError: false };
  write.updateResult(result);
  write.setExpanded(true);
  transcript.addChild(write);
  const native = transcript.render(80);
  const before = JSON.stringify(result);
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    assert.deepEqual(transcript.render(80), native);
    assert.doesNotMatch(transcript.render(80).join('\n'), /Retained data/);
    assert.equal(JSON.stringify(result), before);
  } finally { dispose(); }
});

test('new members of an expanded group use their expanded native renderer', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const first = tool('bash', 'first', 'FIRST');
    first.setExpanded(true);
    transcript.addChild(first);
    const read = tool('read', 'later', 'LATER READ', Pi.createReadToolDefinition(process.cwd()));
    transcript.addChild(read);
    const expanded = transcript.render(80).join('\n');
    assert.match(expanded, /LATER READ/);
  } finally { dispose(); }
});

test('a rendering-adapter fault restores native content and reports only once', () => {
  const messages = [];
  const dispose = install(config, Pi.VERSION, value => messages.push(value), { pi: { ...Pi, keyText() { throw new Error('changed key helper'); } }, tui: Tui, ui });
  try {
    const transcript = new Container();
    transcript.addChild(tool('bash', 'safe', 'FALLBACK DETAIL'));
    assert.match(transcript.render(80).join('\n'), /FALLBACK DETAIL/);
    assert.match(transcript.render(80).join('\n'), /FALLBACK DETAIL/);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /native/);
  } finally { dispose(); }
});

test('a changed host shape is rejected before patching', () => {
  const before = Container.prototype.render;
  for (const host of [{ pi: { ...Pi, ToolExecutionComponent: undefined }, tui: Tui, ui }, { pi: Pi, tui: Tui, ui: { theme: undefined } }]) {
    const messages = [];
    assert.equal(install(config, Pi.VERSION, value => messages.push(value), host), undefined);
    assert.equal(Container.prototype.render, before);
    assert.equal(messages.length, 1);
  }
});

test('session projection faults also fall back to native rendering', () => {
  const messages = [];
  const dispose = install(config, Pi.VERSION, message => messages.push(message), { pi: Pi, tui: Tui, ui, session: { getBranch() { throw new Error('session unavailable'); } } });
  try {
    const transcript = new Container();
    transcript.addChild(tool('bash', 'safe', 'NATIVE DETAIL'));
    assert.match(transcript.render(80).join('\n'), /NATIVE DETAIL/);
    assert.equal(messages.length, 1);
  } finally { dispose(); }
});

test('disposed mouse wrappers do not render the transcript again', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  const staleMouse = Container.prototype.handleMouse;
  const transcript = new Container();
  transcript.addChild(tool('bash', 'mouse', 'DETAIL'));
  transcript.render(80);
  dispose();
  transcript.render = () => { throw new Error('unexpected render'); };
  const call = transcript.children[0];
  call.render = () => { throw new Error('unexpected tool render'); };
  assert.doesNotThrow(() => staleMouse.call(transcript, { type: 'move', width: 80, height: 10, x: 0, y: 0 }));
});

test('direct transcript changes and user/skill boundaries preserve native cards and failures', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const first = tool('bash', 'failed', 'failure detail');
    first.updateResult({ content: [{ type: 'text', text: 'Command aborted' }], isError: true });
    const pending = tool('bash', 'pending', 'partial');
    pending.updateResult({ content: [{ type: 'text', text: 'partial' }], isError: false }, true);
    const unknown = tool('custom', 'native', 'NATIVE RESULT');
    transcript.children.push(first, pending, unknown);
    assert.match(transcript.render(80).join('\n'), /bash ×2[\s\S]*failed: bash; 1 pending/);
    assert.match(transcript.render(80).join('\n'), /NATIVE RESULT/);
    transcript.children.splice(1, 0, new UserMessageComponent('next'));
    assert.equal((transcript.render(80).join('\n').match(/bash ×1/g) ?? []).length, 2);
    transcript.children.push(new SkillInvocationMessageComponent({ name: 'test', location: '/test', content: 'skill', userMessage: undefined }), tool('read', 'read-only', 'hidden'));
    assert.match(transcript.render(80).join('\n'), /read ×1/);
  } finally { dispose(); }
});

test('compatible host signatures load regardless of version and old disposal preserves a later owner', () => {
  const original = Container.prototype.render;
  const messages = [];
  for (const version of ['0.85.0', '0.85.1', '0.86.0', 'garbage', undefined]) {
    const dispose = installPresentation(config, version, message => messages.push(message));
    assert.equal(typeof dispose, 'function');
    dispose();
    assert.equal(Container.prototype.render, original);
  }
  assert.deepEqual(messages, []);
  const first = installPresentation(config, Pi.VERSION, () => {});
  assert.equal(installPresentation(config, Pi.VERSION, () => {}), undefined);
  first();
  const second = installPresentation(config, Pi.VERSION, () => {});
  const current = Container.prototype.render;
  first();
  assert.equal(Container.prototype.render, current);
  second();
  assert.equal(Container.prototype.render, original);
});

test('third-party wrapping remains intact and disposed closures become native', () => {
  const original = Container.prototype.render;
  const originalExpansion = Pi.InteractiveMode.prototype.setToolsExpanded;
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  const installed = Container.prototype.render;
  const installedExpansion = Pi.InteractiveMode.prototype.setToolsExpanded;
  function thirdParty(width) { return installed.call(this, width); }
  function thirdPartyExpansion(expanded) { return installedExpansion.call(this, expanded); }
  Container.prototype.render = thirdParty;
  Pi.InteractiveMode.prototype.setToolsExpanded = thirdPartyExpansion;
  try {
    dispose();
    assert.equal(Container.prototype.render, thirdParty);
    assert.equal(Pi.InteractiveMode.prototype.setToolsExpanded, thirdPartyExpansion);
    const transcript = new Container();
    transcript.addChild(tool('bash', 'visible', 'NATIVE'));
    assert.match(transcript.render(80).join('\n'), /NATIVE/);
  } finally { Container.prototype.render = original; Pi.InteractiveMode.prototype.setToolsExpanded = originalExpansion; dispose(); }
});

test('ungrouped lines mode previews only a short display command, expansion preserves full arguments', () => {
  const dispose = installPresentation({ ...config, grouping: false }, Pi.VERSION, () => {});
  try {
    const command = '# check\nprintf "' + '中😀'.repeat(80) + '"\necho END_OF_COMMAND';
    const first = new ToolExecutionComponent('bash', 'long', { command }, {}, bash, ui, process.cwd());
    first.updateResult({ content: [{ type: 'text', text: 'OUTPUT_ONLY_ON_EXPAND' }], isError: false });
    const transcript = new Container();
    transcript.addChild(first);
    const collapsed = transcript.render(30);
    assert.match(collapsed.join('\n'), /check/);
    assert.doesNotMatch(collapsed.join('\n'), /END_OF_COMMAND|OUTPUT_ONLY_ON_EXPAND/);
    assert.ok(collapsed.every(line => visibleWidth(line) <= 30));
    assert.equal(first.args.command, command);
    first.setExpanded(true);
    const expanded = transcript.render(80).join('\n');
    assert.match(expanded, /END_OF_COMMAND/);
    assert.match(expanded, /OUTPUT_ONLY_ON_EXPAND/);
  } finally { dispose(); }
});

test('click expansion uses the projected group layout even after resizing', () => {
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const first = tool('bash', 'one', 'ONE');
    const second = tool('bash', 'two', 'TWO');
    transcript.addChild(first);
    transcript.addChild(second);
    const lines = transcript.render(80);
    const event = { type: 'click', button: 'left', x: 1, y: 1, width: 40, height: lines.length, modifiers: { shift: false, alt: false, ctrl: false } };
    assert.equal(transcript.handleMouse(event)?.handled, true);
    assert.equal(first.expanded, true);
    assert.equal(second.expanded, true);
    assert.match(transcript.render(40).join('\n'), /ONE/);
  } finally { dispose(); }
});

test('thinking visibility and streaming remain native across repeated installation', () => {
  const message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE THOUGHT' }, { type: 'text', text: 'PUBLIC TEXT' }], stopReason: 'stop' };
  const serialized = JSON.stringify(message);
  for (let index = 0; index < 10; index++) {
    const dispose = installPresentation(config, Pi.VERSION, () => {});
    try {
      const component = new AssistantMessageComponent(message);
      component.updateContent(message, true);
      assert.equal(component.isStreaming, true);
      assert.equal(component.lastMessage, message);
      assert.match(component.render(80).join('\n'), /PRIVATE THOUGHT/);
      assert.match(component.render(80).join('\n'), /PUBLIC TEXT/);
      dispose();
      assert.match(component.render(80).join('\n'), /PRIVATE THOUGHT/);
    } finally { dispose(); }
  }
  assert.equal(JSON.stringify(message), serialized);
});

test('expanded native controls receive their original mouse events', () => {
  let clicks = 0;
  const definition = { ...bash, renderCall: () => new Text('native call', 0, 0), renderResult: () => new MouseRegion(new Text('NATIVE BUTTON', 0, 0), () => { clicks++; return { handled: true }; }) };
  const dispose = installPresentation(config, Pi.VERSION, () => {});
  try {
    const transcript = new Container();
    const call = tool('bash', 'button', '', definition);
    call.setExpanded(true);
    transcript.addChild(call);
    const lines = transcript.render(80);
    const y = lines.findIndex(line => line.includes('NATIVE BUTTON'));
    assert.ok(y >= 0);
    transcript.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 80, height: lines.length });
    assert.equal(clicks, 1);
    assert.equal(call.expanded, true);
  } finally { dispose(); }
});
