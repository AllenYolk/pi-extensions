import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONVERSATION_MODEL,
  DEFAULT_KEPT_WINDOW_TOKENS,
  DEFAULT_THINKING,
  defaults,
  effective,
  loadConfig,
  saveConfig,
  validateConfig,
} from '../src/config.ts';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const agentDir = () => mkdtempSync(join(tmpdir(), 'pi-compaction-config-'));
const write = (dir, body) => {
  const path = join(dir, 'extensions', 'pi-compaction');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'config.json'), JSON.stringify(body, null, 2));
};

test('the package is inert until it is enabled', () => {
  assert.equal(defaults().enabled, false);
  assert.equal(effective(defaults()).enabled, false);
  // A missing file is the defaults, which are inert.
  const loaded = loadConfig(agentDir());
  assert.equal(loaded.diagnostic, undefined);
  assert.equal(loaded.config.enabled, false);
});

test('the defaults summarise with the conversation model at medium thinking', () => {
  const config = defaults();
  assert.equal(config.summarizerModel, null);
  assert.equal(config.thinking, DEFAULT_THINKING);
  assert.equal(config.keptWindowTokens, DEFAULT_KEPT_WINDOW_TOKENS);
  const settings = effective(config);
  assert.equal(settings.tuple.model, null, 'the default path must not need a second provider signed in');
  assert.equal(settings.tuple.thinking, 'medium');
});

test('a summarizer model and a thinking level round-trip through the file', () => {
  const dir = agentDir();
  saveConfig(dir, { ...defaults(), enabled: true, summarizerModel: 'p/m', thinking: 'off', keptWindowTokens: 4_000 });
  const { config, diagnostic } = loadConfig(dir);
  assert.equal(diagnostic, undefined);
  assert.deepEqual(config, {
    enabled: true,
    summarizerModel: 'p/m',
    thinking: 'off',
    keptWindowTokens: 4_000,
  });
});

test('null and the conversation word both mean the conversation model', () => {
  for (const written of [null, CONVERSATION_MODEL]) {
    const dir = agentDir();
    write(dir, { summarizerModel: written });
    assert.equal(loadConfig(dir).config.summarizerModel, null, String(written));
  }
  // And the saved form has no absent keys, so a reload reads back exactly what was written.
  const dir = agentDir();
  saveConfig(dir, { ...defaults(), summarizerModel: null });
  assert.equal(loadConfig(dir).config.summarizerModel, null);
});

test('a subset keeps the defaults for everything it does not mention', () => {
  const dir = agentDir();
  write(dir, { enabled: true });
  assert.deepEqual(loadConfig(dir).config, { ...defaults(), enabled: true });
});

test('an invalid value is rejected whole, and the caller is told where to look', () => {
  const cases = [
    [{ enabled: 'yes' }, /enabled must be boolean/],
    [{ thinking: 'loud' }, /thinking must be/],
    [{ summarizerModel: 'no-slash' }, /summarizerModel must be/],
    [{ keptWindowTokens: -1 }, /keptWindowTokens must be an integer/],
    [{ keptWindowTokens: 1.5 }, /keptWindowTokens must be an integer/],
    // The removed knobs are unknown fields now, and an unknown field rejects the whole file.
    [{ textBudget: 6_000 }, /unknown field textBudget/],
    [{ preset: 'fast' }, /unknown field preset/],
    [{ prune: true }, /unknown field prune/],
    [{ neverPrune: [] }, /unknown field neverPrune/],
  ];
  for (const [body, pattern] of cases) {
    const dir = agentDir();
    write(dir, body);
    const { config, diagnostic } = loadConfig(dir);
    assert.equal(config, undefined, JSON.stringify(body));
    assert.match(diagnostic, pattern, JSON.stringify(body));
    assert.match(diagnostic, /compaction stays stock Pi/, 'and the caller is told what happens next');
  }
});

test('a configuration assembled by the command goes through the same validation', () => {
  assert.equal(validateConfig(defaults()), undefined);
  assert.match(validateConfig({ ...defaults(), thinking: 'nonsense' }), /thinking must be/);
  assert.match(validateConfig({ ...defaults(), summarizerModel: 'no-slash' }), /summarizerModel must be/);
});
