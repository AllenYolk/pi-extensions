import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, effective, loadConfig, saveConfig, validateConfig, PRESETS } from '../src/config.ts';

mkdirSync('work', { recursive: true });

const withConfig = (raw) => {
  const agentDir = mkdtempSync('work/config-');
  const dir = join(agentDir, 'extensions/pi-compaction');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), typeof raw === 'string' ? raw : JSON.stringify(raw));
  return agentDir;
};

test('the package is inert until it is enabled, and the kept window defaults to its target', () => {
  const agentDir = mkdtempSync('work/config-');
  const { config, diagnostic } = loadConfig(agentDir);
  assert.equal(diagnostic, undefined);
  assert.equal(config.enabled, false);
  assert.equal(config.preset, 'balanced');
  assert.equal(config.keptWindowTokens, 16_000);
  // Inert is not the same as unconfigured: the tuple a first enablement would use is the default.
  assert.deepEqual(effective(config).tuple, PRESETS.balanced);
  assert.equal(effective(config).enabled, false);
});

test('the four presets carry the tuple the specification fixes', () => {
  assert.deepEqual(PRESETS.fast, {
    model: 'minimax-cn/minimax-M3.1-Flash', thinking: 'off', textBudget: 6_000, reasoningBudget: 0,
  });
  assert.deepEqual(PRESETS.balanced, {
    model: 'minimax-cn/minimax-M3.1-Flash', thinking: 'medium', textBudget: 12_000, reasoningBudget: 8_000,
  });
  assert.deepEqual(PRESETS.deep, {
    model: 'conversation', thinking: 'high', textBudget: 12_000, reasoningBudget: 24_000,
  });
  const { config } = loadConfig(withConfig({ enabled: true, preset: 'off' }));
  assert.equal(effective(config).tuple, undefined, 'off is the absence of a preset');
});

test('per-field overrides replace the preset tuple and survive a save and reload', () => {
  const agentDir = withConfig({
    enabled: true,
    preset: 'deep',
    summarizerModel: 'pi-compaction-fixture-pool/pool-summarizer',
    thinking: 'low',
    textBudget: 9_000,
    reasoningBudget: 1_000,
    keptWindowTokens: 4_000,
  });
  const tuple = effective(loadConfig(agentDir).config).tuple;
  assert.deepEqual(tuple, {
    model: 'pi-compaction-fixture-pool/pool-summarizer', thinking: 'low', textBudget: 9_000, reasoningBudget: 1_000,
  });
  saveConfig(agentDir, loadConfig(agentDir).config);
  const reloaded = loadConfig(agentDir).config;
  assert.deepEqual(effective(reloaded).tuple, tuple);
  assert.equal(reloaded.keptWindowTokens, 4_000);
});

test('an invalid value is rejected whole, and the caller is told where to look', () => {
  const invalid = [
    '{',
    'null',
    '[]',
    '{"enabled":"yes"}',
    '{"preset":"quick"}',
    '{"preset":"fast","extra":1}',
    '{"summarizerModel":"gpt-6-luna"}',
    '{"summarizerModel":42}',
    '{"thinking":"extreme"}',
    '{"textBudget":0}',
    '{"textBudget":1.5}',
    '{"textBudget":-1}',
    '{"reasoningBudget":-1}',
    '{"keptWindowTokens":-1}',
  ];
  for (const raw of invalid) {
    const result = loadConfig(withConfig(raw));
    assert.equal(result.config, undefined, raw);
    assert.match(result.diagnostic, /config\.json.*compaction stays stock Pi/s, raw);
  }
});

test('a valid subset keeps the defaults for everything it does not mention', () => {
  const { config, diagnostic } = loadConfig(withConfig({ enabled: true }));
  assert.equal(diagnostic, undefined);
  assert.equal(config.preset, 'balanced');
  assert.equal(config.keptWindowTokens, 16_000);
  assert.equal(config.textBudget, undefined, 'an unset override must not shadow the preset');
});

test('a configuration assembled by the command goes through the same validation', () => {
  assert.equal(validateConfig(defaults()), undefined);
  assert.equal(validateConfig({ ...defaults(), enabled: true, textBudget: 12_000 }), undefined);
  assert.match(validateConfig({ ...defaults(), thinking: "extreme" }), /thinking must be/);
  assert.equal(validateConfig({ ...defaults(), summarizerModel: "conversation" }), undefined);
  assert.match(validateConfig({ ...defaults(), summarizerModel: "gpt-6-luna" }), /summarizerModel must be/);
  assert.match(validateConfig({ ...defaults(), textBudget: 0 }), /textBudget must be an integer/);
});
