import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';

for (const mode of ['regular', 'fullscreen']) for (const scenario of ['fresh', 'resume']) {
  test(`${mode} ${scenario} shows minimal before any command or key input`, { timeout: 30000 }, () => {
    mkdirSync('work', { recursive: true });
    const profile = resolve(mkdtempSync('work/first-paint-'));
    writeFileSync(join(profile, 'settings.json'), JSON.stringify({ theme: 'dark', quietStartup: true, showCacheMissNotices: false }));
    const names = ['bash', 'edit', 'grep', 'readSeek_edit', 'readSeek_grep', 'ordinary_fixture'];
    const message = { role: 'assistant', api: 'anthropic-messages', provider: 'fixture', model: 'fixture', content: names.map(name => ({ type: 'toolCall', id: name, name, arguments: { command: 'printf fixture', path: join(profile, 'fixture.txt') } })), stopReason: 'toolUse', timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const sessionArgs = scenario === 'fresh' ? ['--no-session'] : [];
    if (scenario === 'resume') {
      const session = SessionManager.create(profile, join(profile, 'sessions'));
      session.appendMessage({ role: 'user', content: 'First paint fixture', timestamp: 0 });
      session.appendMessage(message);
      for (const name of names) session.appendMessage({ role: 'toolResult', toolCallId: name, toolName: name, content: [{ type: 'text', text: 'FIRST_PAINT_RAW_OUTPUT' }], isError: false, timestamp: 2 });
      sessionArgs.push('--session', session.getSessionFile());
    }
    const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12', 'python', resolve('test/pty.py'), process.execPath, resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'), '--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions', '--tui-mode', mode, ...sessionArgs, '-e', resolve('src/index.ts'), '-e', resolve('test/fixtures/first-paint.ts')], {
      cwd: profile,
      env: { ...process.env, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: '1', PI_FIRST_PAINT_SCENARIO: scenario, PI_FIRST_PAINT_MESSAGE: JSON.stringify(message), PI_FIRST_PAINT_EXPECT: JSON.stringify([...names.map(name => `${name} ×1`), 'succeeded']) },
      encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr + result.stdout.slice(-4000));
    assert.match(result.stdout, /FIRST_PAINT_VERIFIED/);
    assert.doesNotMatch(result.stdout, /FIRST_PAINT_RAW_OUTPUT|Retained data|Tool output: (?:expanded|collapsed)/);
  });
}
