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
    fallbackModel: null,
    thinking: 'off',
    keptWindowTokens: 4_000,
  });
});

test('no fallback model is the default, and an absent field keeps it', () => {
  assert.equal(defaults().fallbackModel, null);
  assert.equal(effective(defaults()).fallbackModel, null);
  const dir = agentDir();
  write(dir, { enabled: true, summarizerModel: 'p/m' });
  assert.equal(loadConfig(dir).config.fallbackModel, null);
});

test('a fallback model round-trips, and every spelling of none means no fallback', () => {
  const dir = agentDir();
  saveConfig(dir, { ...defaults(), enabled: true, fallbackModel: 'p/f' });
  const { config, diagnostic } = loadConfig(dir);
  assert.equal(diagnostic, undefined);
  assert.equal(config.fallbackModel, 'p/f');
  assert.equal(effective(config).fallbackModel, 'p/f');

  // `conversation` is a spelling of `null` here for the same reason it is for `summarizerModel`:
  // the field names a model, and the word for "not a model" is the one the command already uses.
  // `none` is the command's own spelling, and the file takes it too — two entry points that spell
  // "no fallback" differently is a trap, and a rejected file is the worst way to find out.
  for (const written of [null, CONVERSATION_MODEL, 'none']) {
    const other = agentDir();
    write(other, { fallbackModel: written });
    assert.equal(loadConfig(other).config.fallbackModel, null, String(written));
  }
  // And the saved form has no absent keys, so a reload reads back exactly what was written.
  const roundTrip = agentDir();
  saveConfig(roundTrip, { ...defaults(), fallbackModel: null });
  assert.equal(loadConfig(roundTrip).config.fallbackModel, null);
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

test('a fallback that repeats the summarizer is rejected whole', () => {
  // The same model cannot be its own fallback: the second attempt would fail the same way, and on
  // the one path where it succeeded the announcement would say "the summarizer configured here did
  // not run" and "the model you chose is not the one that wrote it" — both false. Refusing is the
  // whole-file rule the rest of this file already follows.
  const dir = agentDir();
  write(dir, { enabled: true, summarizerModel: 'p/m', fallbackModel: 'p/m' });
  const { config, diagnostic } = loadConfig(dir);
  assert.equal(config, undefined, 'nothing is half-applied');
  assert.match(diagnostic, /fallbackModel must be a different model from summarizerModel/);
  assert.match(diagnostic, /compaction stays stock Pi/);

  // Every other pairing is a real one.
  for (const body of [
    { summarizerModel: 'p/m', fallbackModel: 'p/n' },
    { summarizerModel: 'p/m', fallbackModel: 'q/m' },
    { summarizerModel: 'p/m', fallbackModel: null },
    { summarizerModel: 'p/m', fallbackModel: 'none' },
    { summarizerModel: null, fallbackModel: 'p/m' },
    { summarizerModel: 'conversation', fallbackModel: 'p/m' },
  ]) {
    const other = agentDir();
    write(other, body);
    assert.equal(loadConfig(other).diagnostic, undefined, JSON.stringify(body));
  }
});

test('an invalid value is rejected whole, and the caller is told where to look', () => {
  const cases = [
    [{ enabled: 'yes' }, /enabled must be boolean/],
    [{ thinking: 'loud' }, /thinking must be/],
    [{ summarizerModel: 'no-slash' }, /summarizerModel must be/],
    [{ fallbackModel: 'no-slash' }, /fallbackModel must be/],
    [{ fallbackModel: 7 }, /fallbackModel must be/],
    // `none` is accepted, but only exactly: a near-miss is a malformed model id like any other.
    // `none/x` is not a near-miss — it is a well-formed id whose provider happens to be `none`.
    [{ fallbackModel: 'None' }, /fallbackModel must be/],
    // A half-applied fallback is worse than none, so one bad field still rejects the whole file.
    [{ summarizerModel: 'p/m', fallbackModel: 'no-slash' }, /fallbackModel must be/],
    [{ fallbackModels: 'p/f' }, /unknown field fallbackModels/],
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
  assert.match(validateConfig({ ...defaults(), fallbackModel: 'no-slash' }), /fallbackModel must be/);
  assert.equal(validateConfig({ ...defaults(), fallbackModel: 'p/f' }), undefined);
  assert.match(
    validateConfig({ ...defaults(), summarizerModel: 'p/m', fallbackModel: 'p/m' }),
    /fallbackModel must be a different model from summarizerModel/,
    'the command goes through the same check, so /compaction fallback cannot write a self-fallback',
  );
  assert.equal(validateConfig({ ...defaults(), summarizerModel: 'p/m', fallbackModel: 'p/n' }), undefined);
  // The command's spelling goes through the same validation, so it cannot write a file that would
  // not load back.
  assert.equal(validateConfig({ ...defaults(), fallbackModel: null }), undefined);
});

test('the two model fields do not share a spelling they should not', () => {
  // `none` means "no fallback". For `summarizerModel` there is no such thing: its null is the
  // conversation model, and accepting `none` there would make two different values look alike.
  const dir = agentDir();
  write(dir, { summarizerModel: 'none' });
  assert.equal(loadConfig(dir).config, undefined, 'summarizerModel still rejects it');
  assert.match(loadConfig(dir).diagnostic, /summarizerModel must be/);
});
