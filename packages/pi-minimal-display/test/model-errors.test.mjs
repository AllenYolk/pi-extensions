import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import * as Pi from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../dist/config.js';
import { installPresentation } from '../dist/presentation.js';

const requirePi = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const Tui = await import(pathToFileURL(requirePi.resolve('@earendil-works/pi-tui')).href);

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const textOf = output => stripVTControlCharacters(output).replace(/\s+/g, ' ');

function errorMessage(errorMessage, provider = 'fixture') {
  return { role: 'assistant', api: 'openai-responses', provider, model: 'fixture-model', content: [], stopReason: 'error', errorMessage, usage, timestamp: 1 };
}

async function harness(settings = {}) {
  mkdirSync('work', { recursive: true });
  const profile = resolve(mkdtempSync('work/model-errors-'));
  const manager = Pi.SessionManager.inMemory(profile);
  const services = await Pi.createAgentSessionServices({
    cwd: profile, agentDir: profile,
    settingsManager: Pi.SettingsManager.inMemory({ showImages: false, hideThinkingBlock: false, showCacheMissNotices: false, showTerminalProgress: false, retry: { enabled: true, maxRetries: 3, baseDelayMs: 0, maxAgentDelayMs: 0 }, ...settings }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const created = await Pi.createAgentSessionFromServices({ services, sessionManager: manager });
  const runtime = new Pi.AgentSessionRuntime(created.session, services, async () => { throw new Error('unexpected runtime replacement'); });
  Pi.initTheme('dark');
  const mode = new Pi.InteractiveMode(runtime, { tuiMode: 'regular' });
  mode.ui.stop();
  mode.isInitialized = true;
  const diagnostics = [];
  const config = loadConfig(profile).config;
  const ui = mode.createExtensionUIContext();
  const dispose = installPresentation(config, Pi.VERSION, message => diagnostics.push(message), { pi: Pi, tui: Tui, ui, session: manager });
  assert.equal(typeof dispose, 'function', diagnostics.join('\n'));
  const render = () => textOf(mode.chatContainer.render(100).join('\n'));
  return { mode, session: created.session, runtime, dispose, diagnostics, render, config, ui };
}

async function close(harness) {
  if (!harness || harness.closed) return;
  harness.closed = true;
  harness.dispose?.();
  harness.mode.isInitialized = false;
  harness.mode.stop();
  await harness.runtime.dispose();
}

describe('model request presentation', { concurrency: 1 }, () => {
test('a confirmed pure retry chain keeps every original error and only marks resumed from the host signal', async () => {
  const box = await harness();
  try {
    const first = errorMessage('mafia-o API error (429): {"request id":"one"}');
    const repeated = errorMessage('mafia-o API error (429): {"request id":"one"}');
    for (const [index, message] of [first, repeated].entries()) {
      box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(message));
      await box.mode.handleEvent({ type: 'message_end', message });
      await box.mode.handleEvent({ type: 'auto_retry_start', attempt: index + 1, maxAttempts: 3, delayMs: 0, errorMessage: message.errorMessage });
    }
    assert.match(box.render(), /model request · 2 errors/);
    assert.doesNotMatch(box.render(), /request id/);
    const success = { ...first, content: [{ type: 'text', text: 'RECOVERED' }], stopReason: 'stop', errorMessage: undefined };
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(success));
    await box.mode.handleEvent({ type: 'message_end', message: success });
    await box.mode.handleEvent({ type: 'auto_retry_end', success: true, attempt: 2 });
    assert.match(box.render(), /model request · resumed · 2 errors/);
    assert.match(box.render(), /RECOVERED/);
    const lines = box.mode.chatContainer.render(100);
    const y = lines.findIndex(line => stripVTControlCharacters(line).includes('model request'));
    assert.equal(box.mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 100, height: lines.length })?.handled, true);
    const expanded = box.render();
    assert.match(expanded, /request id":"one"[\s\S]*request id":"one"/);
    assert.equal((expanded.match(/request id/g) ?? []).length, 2);
    assert.doesNotMatch(expanded, /stopped/);
  } finally { await close(box); }
});

test('final retry failure expands every cause and an unrelated saved error stays native', async () => {
  const box = await harness();
  try {
    const historical = errorMessage('historical gateway 500 request id: old');
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(historical));
    const first = errorMessage('429 request id: live-1');
    const last = errorMessage('502 request id: live-2');
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(first));
    await box.mode.handleEvent({ type: 'message_end', message: first });
    await box.mode.handleEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1, delayMs: 0, errorMessage: first.errorMessage });
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(last));
    await box.mode.handleEvent({ type: 'message_end', message: last });
    await box.mode.handleEvent({ type: 'auto_retry_end', success: false, attempt: 1, finalError: last.errorMessage });
    await box.mode.handleEvent({ type: 'agent_settled', aborted: false });
    const output = box.render();
    assert.match(output, /model request · stopped · 2 errors · ctrl\+o to expand/);
    assert.match(output, /Error: 502 request id: live-2/);
    assert.doesNotMatch(output, /request id: live-1/);
    assert.doesNotMatch(output, /Retry failed after/);
    const rawLines = box.mode.chatContainer.render(100);
    const headerLine = rawLines.find(line => stripVTControlCharacters(line).includes('model request · stopped · 2 errors'));
    assert.ok(headerLine, 'stopped header line must exist');
    const colorMode = box.ui.theme.getColorMode();
    const mutedAnsi = Tui.foregroundAnsi(Tui.parseColor('#a4a8bd'), colorMode);
    const stopAnsi = Tui.foregroundAnsi(Tui.parseColor('#ef858b'), colorMode);
    assert.ok(headerLine.includes(`${mutedAnsi}▸`), 'arrow must be muted and collapsed');
    assert.ok(headerLine.includes(`${stopAnsi}model request · stopped`), 'only the stopped title is red');
    assert.ok(headerLine.includes(`${mutedAnsi} · 2 errors`), 'error count suffix must be muted');
    box.mode.setToolsExpanded(true);
    const expandedOutput = box.render();
    assert.match(expandedOutput, /request id: live-1/);
    assert.match(expandedOutput, /request id: live-2/);
    assert.match(expandedOutput, /historical gateway 500/);
    assert.doesNotMatch(expandedOutput, /Retry failed after/);
  } finally { await close(box); }
});

test('historical pure errors followed by assistant reply are projected as resumed', async () => {
  const box = await harness();
  try {
    const err1 = errorMessage('Your requests to gpt-6-astra have exceeded rate limit.');
    const err2 = errorMessage('Your requests to gpt-6-astra have exceeded rate limit.');
    const ok = { ...err1, content: [{ type: 'text', text: 'RECOVERED_REPLY' }], stopReason: 'stop', errorMessage: undefined };
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(err1));
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(err2));
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(ok));

    // Purely rendered from transcript, no live events:
    const output = box.render();
    assert.match(output, /model request · resumed · 2 errors · ctrl\+o to expand/);
    assert.match(output, /RECOVERED_REPLY/);
    assert.doesNotMatch(output, /exceeded rate limit/);

    // Click expands the original errors:
    const lines = box.mode.chatContainer.render(100);
    const y = lines.findIndex(line => stripVTControlCharacters(line).includes('model request'));
    assert.equal(box.mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 100, height: lines.length })?.handled, true);
    assert.match(box.render(), /Error: Your requests to gpt-6-astra have exceeded rate limit/);
  } finally { await close(box); }
});

test('historical unrecovered pure errors are projected as stopped, closed by default, and can be expanded', async () => {
  const box = await harness();
  try {
    const err1 = errorMessage('rate limit exceeded attempt 1');
    const err2 = errorMessage('rate limit exceeded attempt 2');
    const err3 = errorMessage('rate limit exceeded attempt 3');
    const err4 = errorMessage('OpenAI API error (500): encrypted content verification failure');
    box.mode.chatContainer.addChild(new Pi.UserMessageComponent('first prompt'));
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(err1));
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(err2));
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(err3));
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(err4));
    box.mode.chatContainer.addChild(new Pi.UserMessageComponent('second prompt'));

    // Matches the user screenshot: 4 errors stopped before the next user prompt, closed by default:
    const initialOutput = box.render();
    assert.match(initialOutput, /model request · stopped · 4 errors · ctrl\+o to expand/);
    assert.match(initialOutput, /Error: OpenAI API error \(500\): encrypted content verification failure/);
    assert.doesNotMatch(initialOutput, /rate limit exceeded/);
    const narrow = stripVTControlCharacters(box.mode.chatContainer.render(40).join('\n'));
    assert.equal((narrow.match(/Error:/g) ?? []).length, 1);
    assert.match(narrow, /\.\.\./);
    assert.doesNotMatch(narrow, /encrypted content verification failure/);

    // Toggle expand via click
    const lines = box.mode.chatContainer.render(100);
    const y = lines.findIndex(line => stripVTControlCharacters(line).includes('model request · stopped'));
    assert.equal(box.mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 100, height: lines.length })?.handled, true);

    // Now expanded:
    const expandedOutput = box.render();
    assert.match(expandedOutput, /model request · stopped · 4 errors · ctrl\+o to collapse/);
    assert.match(expandedOutput, /rate limit exceeded attempt 1/);
    assert.match(expandedOutput, /encrypted content verification failure/);

    // Toggle collapse via click
    const expandedLines = box.mode.chatContainer.render(100);
    const y2 = expandedLines.findIndex(line => stripVTControlCharacters(line).includes('model request · stopped'));
    assert.equal(box.mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y: y2, width: 100, height: expandedLines.length })?.handled, true);

    // Collapsed back:
    const collapsedOutput = box.render();
    assert.match(collapsedOutput, /model request · stopped · 4 errors · ctrl\+o to expand/);
    assert.match(collapsedOutput, /Error: OpenAI API error \(500\): encrypted content verification failure/);
    assert.doesNotMatch(collapsedOutput, /rate limit exceeded/);
    assert.match(collapsedOutput, /first prompt/);
    assert.match(collapsedOutput, /second prompt/);
  } finally { await close(box); }
});

function scripted(message, failed) {
  const event = failed ? { type: 'error', reason: 'error', error: message } : { type: 'done', reason: 'stop', message };
  return { async *[Symbol.asyncIterator]() { yield event; }, result: async () => message };
}

const fixtureModel = {
  id: 'fixture-model', name: 'fixture', api: 'openai-responses', provider: 'fixture', baseUrl: 'http://127.0.0.1',
  reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000,
};

function transcriptFacts(manager) {
  return manager.getEntries().flatMap(entry => {
    if (entry.type === 'context_edit') return [{ omitted: entry.replacement === null }];
    if (entry.type !== 'message') return [];
    const message = entry.message;
    if (message.role === 'user') return [{ role: 'user' }];
    if (message.role !== 'assistant') return [];
    const text = Array.isArray(message.content) ? message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
    return [{ role: 'assistant', stop: message.stopReason, error: message.errorMessage, text }];
  });
}

test('the real session retry loop folds provider failures without changing saved context', async () => {
  async function run(compact) {
    const box = await harness();
    box.session.modelRuntime.registerProvider('fixture', { apiKey: 'test', api: 'openai-responses', baseUrl: fixtureModel.baseUrl, models: [fixtureModel] });
    await box.session.setModel(fixtureModel);
    let calls = 0;
    box.session.agent.streamFunction = () => {
      const failed = calls < 2;
      const message = failed
        ? errorMessage(`429 scheduler_no_capacity request id: provider-${++calls}`)
        : { role: 'assistant', api: 'openai-responses', provider: 'fixture', model: 'fixture-model', content: [{ type: 'text', text: 'PROVIDER RECOVERED' }], stopReason: 'stop', usage, timestamp: 1 };
      return scripted(message, failed);
    };
    box.mode.subscribeToAgent();
    if (!compact) box.dispose();
    await box.session.prompt('retry please');
    return box;
  }
  const compact = await run(true);
  let native;
  try {
    assert.match(compact.render(), /model request · resumed · 2 errors/);
    assert.doesNotMatch(compact.render(), /provider-1/);
    const lines = compact.mode.chatContainer.render(120);
    const y = lines.findIndex(line => stripVTControlCharacters(line).includes('model request'));
    compact.mode.chatContainer.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 120, height: lines.length });
    const expanded = compact.render();
    assert.match(expanded, /provider-1/);
    assert.match(expanded, /provider-2/);
    assert.match(expanded, /PROVIDER RECOVERED/);
    const saved = transcriptFacts(compact.session.sessionManager);
    await close(compact);
    native = await run(false);
    assert.doesNotMatch(native.render(), /model request/);
    assert.match(native.render(), /provider-1/);
    assert.match(native.render(), /provider-2/);
    assert.deepEqual(saved, transcriptFacts(native.session.sessionManager));
    assert.deepEqual(saved.filter(item => item.role === 'assistant').map(item => item.error), [ '429 scheduler_no_capacity request id: provider-1', '429 scheduler_no_capacity request id: provider-2', undefined ]);
  } finally {
    if (compact.dispose) await close(compact);
    if (native) await close(native);
  }
});

test('a live retry failure folds every provider error and omits the unsaved retry summary', async () => {
  const box = await harness({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 0, maxAgentDelayMs: 0 } });
  try {
    box.session.modelRuntime.registerProvider('fixture', { apiKey: 'test', api: 'openai-responses', baseUrl: fixtureModel.baseUrl, models: [fixtureModel] });
    await box.session.setModel(fixtureModel);
    let calls = 0;
    box.session.agent.streamFunction = () => scripted(errorMessage(`503 model_unavailable request id: fail-${++calls}`), true);
    box.mode.subscribeToAgent();
    await box.session.prompt('fail please');
    const output = box.render();
    assert.match(output, /model request · stopped · 4 errors/);
    assert.match(output, /Error: 503 model_unavailable request id: fail-4/);
    assert.doesNotMatch(output, /fail-1|Retry failed after/);
    box.mode.setToolsExpanded(true);
    const expanded = box.render();
    for (const id of ['fail-1', 'fail-2', 'fail-3', 'fail-4']) assert.match(expanded, new RegExp(id));
    assert.doesNotMatch(expanded, /Retry failed after/);
  } finally { await close(box); }
});

test('cancelling a live retry leaves the native error instead of a stopped request', async () => {
  const box = await harness({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 250, maxAgentDelayMs: 250 } });
  try {
    box.session.modelRuntime.registerProvider('fixture', { apiKey: 'test', api: 'openai-responses', baseUrl: fixtureModel.baseUrl, models: [fixtureModel] });
    await box.session.setModel(fixtureModel);
    box.session.agent.streamFunction = () => scripted(errorMessage('429 request id: cancel-1'), true);
    box.mode.subscribeToAgent();
    const pending = box.session.prompt('cancel please');
    for (let attempt = 0; attempt < 40 && !box.session.isRetrying; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(box.session.isRetrying, true);
    await box.session.abort();
    await pending;
    const output = box.render();
    assert.doesNotMatch(output, /model request|stopped|resumed/);
    assert.match(output, /request id: cancel-1/);
  } finally { await close(box); }
});

test('partial output, cancellation and a later success do not invent a repaired or stopped chain', async () => {
  const box = await harness();
  try {
    const first = errorMessage('429 request id: partial-before');
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(first));
    await box.mode.handleEvent({ type: 'message_end', message: first });
    await box.mode.handleEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: first.errorMessage });
    const partial = { ...errorMessage('429 request id: partial-after'), content: [{ type: 'text', text: 'PARTIAL OUTPUT' }] };
    box.mode.chatContainer.addChild(new Pi.AssistantMessageComponent(partial));
    await box.mode.handleEvent({ type: 'message_end', message: partial });
    const output = box.render();
    assert.doesNotMatch(output, /model request/);
    assert.match(output, /partial-before/);
    assert.match(output, /PARTIAL OUTPUT/);
    assert.match(output, /partial-after/);
  } finally { await close(box); }
});
});
