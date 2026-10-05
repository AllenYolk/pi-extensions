import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { Container } from '@earendil-works/pi-tui';
import minimalDisplay from '../dist/index.js';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionManager, initTheme } from '@earendil-works/pi-coding-agent';
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';

initTheme('dark');

test('session entry defaults to minimal, reload preserves global expansion, and status never enables it', async () => {
  mkdirSync('work', { recursive: true });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = resolve(mkdtempSync('work/lifecycle-'));
  const events = new Map();
  const commands = new Map();
  let expanded = true;
  let conflict = false;
  let rejectCollapse = false;
  minimalDisplay({ on: (name, callback) => events.set(name, callback), registerCommand: (name, command) => commands.set(name, command), getAllTools: () => conflict ? [{ name: 'conflict', sourceInfo: { source: 'npm:pi-compact-display' } }] : [] });
  const ctx = { mode: 'tui', hasUI: true, sessionManager: SessionManager.inMemory(process.cwd()), ui: { get theme() { return theme; }, getToolsExpanded: () => expanded, setToolsExpanded(value) { expanded = value; if (rejectCollapse && !value) throw new Error('host collapse failed'); }, notify() {} } };
  try {
    for (const reason of ['startup', 'new', 'resume', 'fork']) {
      expanded = true;
      await events.get('session_start')({ reason }, ctx);
      assert.equal(expanded, false, reason);
      const installed = Container.prototype.render;
      await commands.get('minimal-display').handler('', ctx);
      assert.equal(Container.prototype.render, installed);
      assert.equal(expanded, false);
      await events.get('session_shutdown')({ reason: 'reload' }, ctx);
    }
    expanded = true;
    await events.get('session_start')({ reason: 'reload' }, ctx);
    assert.equal(expanded, true);
    await events.get('session_shutdown')({ reason: 'reload' }, ctx);
    conflict = true;
    await events.get('session_start')({ reason: 'new' }, ctx);
    assert.equal(expanded, true, 'failed activation must preserve host expansion');
    conflict = false;
    rejectCollapse = true;
    const original = Container.prototype.render;
    await events.get('session_start')({ reason: 'new' }, ctx);
    assert.equal(expanded, true, 'a failed native transition restores previous expansion');
    assert.equal(Container.prototype.render, original, 'failed initialization must dispose its patch');
  } finally {
    await events.get('session_shutdown')({}, ctx);
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test('RPC/json/print contexts never activate patches even when they offer UI methods', async () => {
  const original = Container.prototype.render;
  const events = new Map();
  minimalDisplay({ on: (name, callback) => events.set(name, callback), registerCommand() {}, getAllTools() { throw new Error('non-TUI initialization must not inspect tools'); } });
  for (const mode of ['rpc', 'json', 'print']) {
    await events.get('session_start')({}, { mode, hasUI: true });
    assert.equal(Container.prototype.render, original);
    await events.get('session_shutdown')();
  }
});

test('a third-party wrapper cannot keep a disposed session alive through its diagnostic callback', () => {
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as Pi from '@earendil-works/pi-coding-agent';
    import * as Tui from '@earendil-works/pi-tui';
    import { installPresentation } from './dist/presentation.js';
    import { theme } from './node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
    import { loadConfig } from './dist/config.js';
    Pi.initTheme('dark');
    function wrap(installed) { return function(width) { return installed.call(this, width); }; }
    function disposedSession() {
      const session = Pi.SessionManager.inMemory(process.cwd());
      const ctx = { sessionManager: session, ui: { notify() {}, get theme() { assert.ok(ctx.sessionManager); return theme; } } };
      const reference = new WeakRef(session);
      const dispose = installPresentation(loadConfig('work/missing').config, Pi.VERSION, message => ctx.ui.notify(message), { pi: Pi, tui: Tui, ui: ctx.ui, session });
      assert.equal(typeof dispose, 'function');
      Tui.Container.prototype.render = wrap(Tui.Container.prototype.render);
      dispose();
      return reference;
    }
    const reference = disposedSession();
    for (let attempt = 0; attempt < 8; attempt++) { await new Promise(setImmediate); global.gc(); }
    assert.equal(reference.deref(), undefined, 'disposed wrapper retains the old session');
  `], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('a later status wrapper cannot keep a disposed session alive through the toggle adapter', () => {
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as Pi from '@earendil-works/pi-coding-agent';
    import * as Tui from '@earendil-works/pi-tui';
    import { installPresentation } from './dist/presentation.js';
    import { loadConfig } from './dist/config.js';
    Pi.initTheme('dark');
    let retainedStatus;
    function wrapStatus(captured) {
      return function(message) { return captured.call(this, message); };
    }
    function retainStatus(mode) {
      const captured = this.mode.showStatus;
      retainedStatus = wrapStatus(captured);
      this.mode.showStatus = retainedStatus;
    }
    function escapedSession() {
      const session = Pi.SessionManager.inMemory(process.cwd());
      const fake = {
        session,
        toolOutputExpanded: false,
        customHeader: undefined,
        builtInHeader: undefined,
        loadedResourcesContainer: new Tui.Container(),
        chatContainer: new Tui.Container(),
        ui: { requestRender() {} },
        showStatus() {},
      };
      const reference = new WeakRef(session);
      const dispose = installPresentation(loadConfig('work/missing').config, Pi.VERSION, () => {}, { pi: Pi, tui: Tui, ui: { theme: { fg: (_c, text) => text, bg: (_c, text) => text, bold: text => text } }, session });
      assert.equal(typeof dispose, 'function');
      fake.chatContainer.addChild({ mode: fake, render: () => [], invalidate() {}, setExpanded: retainStatus });
      Pi.InteractiveMode.prototype.setToolsExpanded.call(fake, true);
      dispose();
      return reference;
    }
    const reference = escapedSession();
    for (let attempt = 0; attempt < 8; attempt++) { await new Promise(setImmediate); global.gc(); }
    assert.equal(reference.deref(), undefined, 'temporary toggle adapter retains the old session');
  `], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
