import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_NEVER_PRUNE, defaults, effective, loadConfig, saveConfig, validateConfig, PRESETS } from '../src/config.ts';

mkdirSync('work', { recursive: true });

const withConfig = (raw) => {
  const agentDir = mkdtempSync('work/config-');
  const dir = join(agentDir, 'extensions/pi-compaction');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), typeof raw === 'string' ? raw : JSON.stringify(raw));
  return agentDir;
};

test('the package is inert until it is enabled, and summarises with the conversation model', () => {
  const agentDir = mkdtempSync('work/config-');
  const { config, diagnostic } = loadConfig(agentDir);
  assert.equal(diagnostic, undefined);
  assert.equal(config.enabled, false);
  assert.equal(config.preset, 'balanced');
  assert.equal(config.summarizerModel, null, 'the persisted default is null, the conversation model');
  assert.equal(config.keptWindowTokens, 16_000);
  // Inert is not the same as unconfigured: the tuple a first enablement would use is the default.
  assert.deepEqual(effective(config).tuple, PRESETS.balanced);
  assert.equal(effective(config).enabled, false);
  // Pruning is on once the package is enabled, and is not a summarizer strategy.
  assert.equal(config.prune, true);
  assert.equal(config.pruneWindowTokens, 16_000);
  assert.deepEqual(config.neverPrune, DEFAULT_NEVER_PRUNE);
  assert.equal(effective({ ...config, preset: 'off' }).tuple, undefined, 'pruning does not need a preset');
  assert.equal(effective({ ...config, preset: 'off' }).prune, true);
});

test('the four presets carry the tuple the specification fixes', () => {
  assert.deepEqual(PRESETS.fast, { model: null, thinking: 'off', textBudget: 6_000, reasoningBudget: 0 });
  assert.deepEqual(PRESETS.balanced, { model: null, thinking: 'medium', textBudget: 12_000, reasoningBudget: 8_000 });
  assert.deepEqual(PRESETS.deep, { model: null, thinking: 'high', textBudget: 12_000, reasoningBudget: 24_000 });
  for (const tuple of Object.values(PRESETS)) {
    assert.equal(tuple.model, null, 'every preset summarises with the conversation model by default');
  }
  const { config } = loadConfig(withConfig({ enabled: true, preset: 'off' }));
  assert.equal(effective(config).tuple, undefined, 'off is the absence of a preset');
});

test('an explicit summarizer model overrides every preset, and survives a save and reload', () => {
  const agentDir = withConfig({
    enabled: true,
    preset: 'deep',
    summarizerModel: 'minimax-cn/minimax-M3.1-Flash',
    thinking: 'low',
    textBudget: 9_000,
    reasoningBudget: 1_000,
    keptWindowTokens: 4_000,
  });
  const tuple = effective(loadConfig(agentDir).config).tuple;
  assert.deepEqual(tuple, {
    model: 'minimax-cn/minimax-M3.1-Flash', thinking: 'low', textBudget: 9_000, reasoningBudget: 1_000,
  });
  saveConfig(agentDir, loadConfig(agentDir).config);
  const reloaded = loadConfig(agentDir).config;
  assert.deepEqual(effective(reloaded).tuple, tuple);
  assert.equal(reloaded.keptWindowTokens, 4_000);
});

test('null and the conversation word both mean the conversation model', () => {
  for (const raw of [{ summarizerModel: null }, { summarizerModel: 'conversation' }, {}]) {
    const { config, diagnostic } = loadConfig(withConfig(raw));
    assert.equal(diagnostic, undefined, JSON.stringify(raw));
    assert.equal(config.summarizerModel, null, JSON.stringify(raw));
    assert.equal(effective(config).tuple.model, null, JSON.stringify(raw));
  }
  // The persisted default is literally null, not an absent key.
  const agentDir = mkdtempSync('work/config-');
  saveConfig(agentDir, defaults());
  const written = JSON.parse(readFileSync(join(agentDir, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.equal('summarizerModel' in written, true);
  assert.equal(written.summarizerModel, null);
  assert.deepEqual(written, {
    enabled: false,
    preset: 'balanced',
    summarizerModel: null,
    keptWindowTokens: 16_000,
    prune: true,
    pruneWindowTokens: 16_000,
    neverPrune: DEFAULT_NEVER_PRUNE,
  });
});

test('the prune knobs round-trip, and an emptied never-prune list stays emptied', () => {
  const agentDir = withConfig({ enabled: true, prune: false, pruneWindowTokens: 0, neverPrune: ['bash', 'bash', 'deploy'] });
  const { config, diagnostic } = loadConfig(agentDir);
  assert.equal(diagnostic, undefined);
  assert.equal(config.prune, false);
  assert.equal(config.pruneWindowTokens, 0);
  assert.deepEqual(config.neverPrune, ['bash', 'deploy'], 'duplicates collapse');

  saveConfig(agentDir, config);
  const reloaded = loadConfig(agentDir).config;
  assert.equal(reloaded.prune, false);
  assert.equal(reloaded.pruneWindowTokens, 0);
  assert.deepEqual(reloaded.neverPrune, ['bash', 'deploy']);

  saveConfig(agentDir, { ...config, neverPrune: [] });
  assert.deepEqual(loadConfig(agentDir).config.neverPrune, [], 'an explicitly emptied list is not the default again');
  // Pruning is off independently of the preset and of the summarizer strategy.
  const settings = effective({ ...reloaded, preset: 'off' });
  assert.equal(settings.prune, false);
  assert.equal(settings.tuple, undefined);
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
    '{"summarizerModel":false}',
    '{"thinking":"extreme"}',
    '{"textBudget":0}',
    '{"textBudget":1.5}',
    '{"textBudget":-1}',
    '{"reasoningBudget":-1}',
    '{"keptWindowTokens":-1}',
    '{"prune":"yes"}',
    '{"pruneWindowTokens":-1}',
    '{"pruneWindowTokens":1.5}',
    '{"neverPrune":"bash"}',
    '{"neverPrune":["bash",42]}',
    '{"neverPrune":[""]}',
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
  assert.equal(config.summarizerModel, null);
  assert.equal(config.keptWindowTokens, 16_000);
  assert.equal(config.prune, true);
  assert.equal(config.pruneWindowTokens, 16_000);
  assert.deepEqual(config.neverPrune, DEFAULT_NEVER_PRUNE);
  assert.equal(config.textBudget, undefined, 'an unset override must not shadow the preset');
});

test('a configuration assembled by the command goes through the same validation', () => {
  assert.equal(validateConfig(defaults()), undefined);
  assert.equal(validateConfig({ ...defaults(), enabled: true, textBudget: 12_000 }), undefined);
  assert.equal(validateConfig({ ...defaults(), summarizerModel: null }), undefined);
  assert.equal(validateConfig({ ...defaults(), summarizerModel: 'mafia-g/gemini-3.8-flash' }), undefined);
  assert.match(validateConfig({ ...defaults(), thinking: 'extreme' }), /thinking must be/);
  assert.match(validateConfig({ ...defaults(), textBudget: 0 }), /textBudget must be an integer/);
  assert.match(validateConfig({ ...defaults(), summarizerModel: 'gpt-6-luna' }), /summarizerModel must be/);
  assert.match(validateConfig({ ...defaults(), pruneWindowTokens: -1 }), /pruneWindowTokens must be an integer/);
  assert.match(validateConfig({ ...defaults(), neverPrune: ['ok', ''] }), /neverPrune must be an array/);
  assert.equal(validateConfig({ ...defaults(), prune: false, neverPrune: [] }), undefined);
});
