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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
    redistill: null,
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

test('redistill thresholds round-trip through the file', () => {
  const dir = agentDir();
  saveConfig(dir, { ...defaults(), redistill: { aboveTokens: 4_000, targetTokens: 6_000 } });
  const { config, diagnostic } = loadConfig(dir);
  assert.equal(diagnostic, undefined);
  assert.deepEqual(config.redistill, { aboveTokens: 4_000, targetTokens: 6_000 });
  assert.deepEqual(effective(config).redistill, { aboveTokens: 4_000, targetTokens: 6_000 });
});

test('redistill is off unless both thresholds are given', () => {
  // Absent, null and half-configured all mean off: the package then behaves exactly as 0.2.x does.
  for (const body of [{}, { redistill: null }, { redistill: { aboveTokens: 4_000 } }, { redistill: { targetTokens: 6_000 } }]) {
    const dir = agentDir();
    write(dir, body);
    const { config, diagnostic } = loadConfig(dir);
    assert.equal(diagnostic, undefined, JSON.stringify(body));
    assert.equal(config.redistill, null, JSON.stringify(body));
    assert.equal(effective(config).redistill, null, JSON.stringify(body));
  }
  assert.equal(defaults().redistill, null);
});

test('a half-configured redistill validates the field that is there', () => {
  // Off because the counterpart is missing, not because nobody looked: the field that IS present goes
  // through the same check it would go through next to its counterpart, so a typo cannot hide behind
  // a missing key and silently disable the feature.
  for (const [field, value] of [
    ['aboveTokens', '4000'],
    ['aboveTokens', 0],
    ['aboveTokens', 2_000_000],
    ['aboveTokens', 1.5],
    ['targetTokens', 'soon'],
    ['targetTokens', -1],
    ['targetTokens', null],
  ]) {
    const dir = agentDir();
    write(dir, { redistill: { [field]: value } });
    const { config, diagnostic } = loadConfig(dir);
    assert.equal(config, undefined, `redistill.${field} = ${JSON.stringify(value)}`);
    assert.match(diagnostic, new RegExp(`redistill\\.${field} must be an integer`), `redistill.${field} = ${JSON.stringify(value)}`);
    assert.match(diagnostic, /compaction stays stock Pi/);
  }
});

test('a save refuses to erase a half-written redistill, and says what is wrong with it', () => {
  // `redistill` is file-only, so a save that dropped the half-written value would destroy something
  // the command surface cannot restore, with nothing said. The loader calls this pair off, because a
  // missing counterpart means off; the saver refuses to erase it, and the message says so and names
  // the field that is missing rather than guessing at a cause.
  const dir = agentDir();
  const file = join(dir, 'extensions', 'pi-compaction', 'config.json');
  write(dir, { enabled: true, thinking: 'off', redistill: { aboveTokens: 4_000 } });
  const before = readFileSync(file, 'utf8');
  const loaded = loadConfig(dir);
  assert.equal(loaded.diagnostic, undefined, 'the loader accepts it');
  assert.equal(loaded.config.redistill, null, 'and reads it as off');
  assert.throws(
    () => saveConfig(dir, { ...loaded.config, thinking: 'high' }),
    (error) => {
      assert.match(error.message, /refusing to rewrite .*config\.json: it carries a redistill/);
      assert.match(error.message, /cannot adopt: it is missing targetTokens/, 'the actual reason');
      assert.match(error.message, /redistill is off until the pair is complete/);
      assert.match(error.message, /complete it with both aboveTokens and targetTokens, or remove it/);
      return true;
    },
  );
  assert.equal(readFileSync(file, 'utf8'), before, 'the file is untouched');

  // A malformed field is named too, rather than reported as a missing counterpart.
  const malformed = agentDir();
  write(malformed, { enabled: true, redistill: { aboveTokens: 'lots', targetTokens: 6_000 } });
  assert.throws(
    () => saveConfig(malformed, { ...defaults(), enabled: true }),
    (error) => {
      assert.match(error.message, /cannot adopt: redistill\.aboveTokens must be an integer/);
      assert.doesNotMatch(error.message, /it is missing/, 'and not as a missing field');
      return true;
    },
  );
});

test('a save keeps the redistill the file carries instead of reverting an edit', () => {
  // `redistill` is file-only and the in-memory copy only refreshes on session_start, so a threshold
  // edited in the file mid-session must survive an unrelated `/compaction` change — and the caller has
  // to be told what was written, or the status view would go on reporting the stale pair.
  const dir = agentDir();
  const file = join(dir, 'extensions', 'pi-compaction', 'config.json');
  write(dir, { enabled: true, redistill: { aboveTokens: 4_000, targetTokens: 6_000 } });
  const written = saveConfig(dir, { ...defaults(), enabled: true, keptWindowTokens: 5_000 });
  assert.deepEqual(written.redistill, { aboveTokens: 4_000, targetTokens: 6_000 }, 'the caller is told what was written');
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.redistill, { aboveTokens: 4_000, targetTokens: 6_000 }, 'the file keeps its own pair');
  assert.equal(onDisk.keptWindowTokens, 5_000, 'and the change being saved still lands');

  // The file wins over a different in-memory pair: the file is where a file-only field is edited.
  const edited = agentDir();
  const editedFile = join(edited, 'extensions', 'pi-compaction', 'config.json');
  write(edited, { enabled: true, redistill: { aboveTokens: 100, targetTokens: 200 } });
  const fromEdit = saveConfig(edited, { ...defaults(), enabled: true, redistill: { aboveTokens: 4_000, targetTokens: 6_000 } });
  assert.deepEqual(fromEdit.redistill, { aboveTokens: 100, targetTokens: 200 });
  assert.deepEqual(JSON.parse(readFileSync(editedFile, 'utf8')).redistill, { aboveTokens: 100, targetTokens: 200 });

  // With nothing on disk, the in-memory value is what gets written.
  const fresh = agentDir();
  const freshFile = join(fresh, 'extensions', 'pi-compaction', 'config.json');
  write(fresh, { enabled: true });
  const fromMemory = saveConfig(fresh, { ...defaults(), enabled: true, redistill: { aboveTokens: 1, targetTokens: 2 } });
  assert.deepEqual(fromMemory.redistill, { aboveTokens: 1, targetTokens: 2 });
  assert.deepEqual(JSON.parse(readFileSync(freshFile, 'utf8')).redistill, { aboveTokens: 1, targetTokens: 2 });
});

test('repairing a rejected file keeps the redistill it carried', () => {
  // A file the loader rejects whole is repaired from the command — that is how `/compaction <verb>`
  // fixes a broken file — so the save must not be refused. It must also not lose the `redistill` that
  // file carried: the fault was somewhere else in it, and that field is file-only.
  const dir = agentDir();
  const file = join(dir, 'extensions', 'pi-compaction', 'config.json');
  write(dir, { enabled: true, thinking: 'turbo', redistill: { aboveTokens: 4_000, targetTokens: 6_000 } });
  const loaded = loadConfig(dir);
  assert.equal(loaded.config, undefined, 'the file is rejected whole');
  assert.match(loaded.diagnostic, /thinking must be/);

  const written = saveConfig(dir, { ...defaults(), fallbackModel: 'p/f' });
  assert.deepEqual(written.redistill, { aboveTokens: 4_000, targetTokens: 6_000 }, 'the pair survives the repair');
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.redistill, { aboveTokens: 4_000, targetTokens: 6_000 });
  assert.equal(onDisk.fallbackModel, 'p/f', 'and the repair landed');
  assert.equal(onDisk.thinking, 'medium', 'the rejected value is gone, as the repair intends');
  // And the repaired file loads.
  assert.equal(loadConfig(dir).diagnostic, undefined);

  // A file that is not JSON at all is repaired the same way, with no redistill to preserve.
  const broken = agentDir();
  const brokenFile = join(broken, 'extensions', 'pi-compaction', 'config.json');
  mkdirSync(dirname(brokenFile), { recursive: true });
  writeFileSync(brokenFile, '{ not json');
  const repaired = saveConfig(broken, { ...defaults(), enabled: true });
  assert.equal(repaired.redistill, null);
  assert.equal(JSON.parse(readFileSync(brokenFile, 'utf8')).enabled, true);
});

test('this version adds no configuration key of its own beyond redistill', () => {
  // The invariant is not "0.2.x can read it" — `fallbackModel` is on main and 0.2.x rejects that too.
  // It is that this branch does not add a key main does not have: an off `redistill` is an absent key
  // rather than a null one, because a null would be written into every file the command touches and
  // a reader that does not know the field rejects the whole file, not the key.
  const MAIN_FIELDS = ['enabled', 'summarizerModel', 'fallbackModel', 'thinking', 'keptWindowTokens'];
  const dir = agentDir();
  saveConfig(dir, { ...defaults(), enabled: true, summarizerModel: 'p/m' });
  const written = JSON.parse(readFileSync(join(dir, 'extensions', 'pi-compaction', 'config.json'), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), [...MAIN_FIELDS].sort());
  assert.equal('redistill' in written, false, 'an off redistill is an absent key, not a null one');

  // A configured one is written, and is the only key outside main's set.
  saveConfig(dir, { ...defaults(), redistill: { aboveTokens: 4_000, targetTokens: 6_000 } });
  const configured = JSON.parse(readFileSync(join(dir, 'extensions', 'pi-compaction', 'config.json'), 'utf8'));
  assert.deepEqual(configured.redistill, { aboveTokens: 4_000, targetTokens: 6_000 });
  assert.deepEqual(Object.keys(configured).filter((key) => !MAIN_FIELDS.includes(key)), ['redistill']);

  // And an absent key reads back as off, which is what makes omitting it safe.
  const fresh = agentDir();
  write(fresh, { enabled: true });
  assert.equal(loadConfig(fresh).config.redistill, null);
});

test('an unknown or malformed redistill rejects the configuration whole', () => {
  const cases = [
    [{ redistill: { aboveTokens: 4_000, targetTokens: 6_000, prompt: 'be brief' } }, /unknown field redistill\.prompt/],
    [{ redistill: { aboveTokens: 4_000, targetTokens: 6_000, enabled: true } }, /unknown field redistill\.enabled/],
    [{ redistill: 4_000 }, /redistill must be an object/],
    [{ redistill: [4_000, 6_000] }, /redistill must be an object/],
    [{ redistill: { aboveTokens: 'lots', targetTokens: 6_000 } }, /redistill\.aboveTokens must be an integer/],
    [{ redistill: { aboveTokens: 4_000, targetTokens: 1.5 } }, /redistill\.targetTokens must be an integer/],
    [{ redistill: { aboveTokens: 0, targetTokens: 6_000 } }, /redistill\.aboveTokens must be an integer/],
    [{ redistill: { aboveTokens: 4_000, targetTokens: -1 } }, /redistill\.targetTokens must be an integer/],
    [{ redistill: { aboveTokens: 2_000_000, targetTokens: 6_000 } }, /redistill\.aboveTokens must be an integer/],
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
