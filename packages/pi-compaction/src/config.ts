import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The word `/compaction model` and a hand-written config file use for the conversation model. */
export const CONVERSATION_MODEL = 'conversation';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * What a compaction summarises with. `null` is the conversation model, so the default path never
 * depends on a second provider being signed in.
 */
export interface Tuple {
  model: string | null;
  thinking: ThinkingLevel;
}

export const DEFAULT_THINKING: ThinkingLevel = 'medium';

export const DEFAULT_KEPT_WINDOW_TOKENS = 16_000;

/**
 * When to ask the summarizer to re-distil the previous summary instead of only merging into it, and
 * the size to name in that request. Both are required: half-configured means off.
 */
export interface Redistill {
  /** Only ask when the previous summary is at least this many tokens. */
  aboveTokens: number;
  /** The size the instruction names as the merged summary's ceiling. */
  targetTokens: number;
}

/** The file as written. */
export interface Config {
  enabled: boolean;
  /** `null` — the default — is the conversation model. */
  summarizerModel: string | null;
  /** `null` — the default — is no fallback at all, which is the behaviour before this field existed. */
  fallbackModel: string | null;
  thinking: ThinkingLevel;
  keptWindowTokens: number;
  /** `null` — the default — asks for nothing and behaves exactly as 0.2.x does. */
  redistill: Redistill | null;
}

/** What a compaction actually runs with. */
export interface Effective {
  enabled: boolean;
  tuple: Tuple;
  fallbackModel: string | null;
  keptWindowTokens: number;
  redistill: Redistill | null;
}

/**
 * The thinking levels this package accepts, in the order it clamps through them.
 *
 * The one list: the configuration rejects a level outside it, the summarizer clamps through it, and
 * the evaluation harness refuses an arm naming anything else. A second copy would drift the other
 * way — a level added here would become an exit-2 usage error in the harness.
 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const FIELDS = ['enabled', 'summarizerModel', 'fallbackModel', 'thinking', 'keptWindowTokens', 'redistill'];
const REDISTILL_FIELDS = ['aboveTokens', 'targetTokens'];
const MAX_TOKENS = 1_000_000;

export const defaults = (): Config => ({
  enabled: false,
  summarizerModel: null,
  fallbackModel: null,
  thinking: DEFAULT_THINKING,
  keptWindowTokens: DEFAULT_KEPT_WINDOW_TOKENS,
  redistill: null,
});

export function configPath(agentDir: string): string {
  return join(agentDir, 'extensions', 'pi-compaction', 'config.json');
}

/**
 * A `provider/model` id, or `null` — which is the conversation model for `summarizerModel`, and no
 * fallback at all for `fallbackModel`. `spellings` are the extra words a field accepts for `null`;
 * `fallbackModel` takes `none` because the command offers it, and two entry points that spell the
 * same value differently is a trap.
 */
function modelId(value: unknown, label: string, spellings: string[] = []): string | null {
  const accepted = [CONVERSATION_MODEL, ...spellings];
  if (typeof value === 'string' && accepted.includes(value)) return null;
  if (typeof value !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(value)) {
    throw new Error(`${label} must be "provider/model", ${accepted.map((word) => `"${word}"`).join(', ')} or null`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > MAX_TOKENS) {
    throw new Error(`${label} must be an integer from ${min} to ${MAX_TOKENS}`);
  }
  return value;
}

/**
 * A redistill threshold, with the bounds every token number in this package shares. Exported so the
 * evaluation harness refuses the same values a configuration file would.
 */
export function redistillThreshold(value: unknown, label: string): number {
  return integer(value, `redistill.${label}`, 1);
}

function parse(raw: unknown): Config {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config must be an object');
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!FIELDS.includes(key)) throw new Error(`unknown field ${key}`);
  }
  const config = defaults();
  if ('enabled' in record) {
    if (typeof record.enabled !== 'boolean') throw new Error('enabled must be boolean');
    config.enabled = record.enabled;
  }
  if ('summarizerModel' in record && record.summarizerModel !== null) {
    config.summarizerModel = modelId(record.summarizerModel, 'summarizerModel');
  }
  if ('fallbackModel' in record && record.fallbackModel !== null) {
    config.fallbackModel = modelId(record.fallbackModel, 'fallbackModel', ['none']);
  }
  if ('thinking' in record) {
    if (!THINKING_LEVELS.includes(record.thinking as ThinkingLevel)) {
      throw new Error(`thinking must be ${THINKING_LEVELS.join(', ')}`);
    }
    config.thinking = record.thinking as ThinkingLevel;
  }
  if ('keptWindowTokens' in record) config.keptWindowTokens = integer(record.keptWindowTokens, 'keptWindowTokens', 0);
  // The same model cannot be its own fallback. The second attempt would fail the same way, and on
  // the one path where it succeeded the announcement would say the configured summarizer did not
  // run and that the chosen model did not write the summary — both false. Rejecting the pairing is
  // the whole-file rule the rest of this parser already follows.
  if (config.fallbackModel !== null && config.fallbackModel === config.summarizerModel) {
    throw new Error('fallbackModel must be a different model from summarizerModel; the same model cannot be its own fallback');
  }
  config.redistill = redistill(record.redistill);
  return config;
}

/**
 * Absent or null is off. Anything present is validated field by field, so a half-configured pair is
 * off because its counterpart is missing and not because nobody looked at the field that is there —
 * a typo may not hide behind a missing key. A missing counterpart then decides that it is off.
 */
function redistill(raw: unknown): Redistill | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('redistill must be an object or null');
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!REDISTILL_FIELDS.includes(key)) throw new Error(`unknown field redistill.${key}`);
  }
  const above = 'aboveTokens' in record ? redistillThreshold(record.aboveTokens, 'aboveTokens') : undefined;
  const target = 'targetTokens' in record ? redistillThreshold(record.targetTokens, 'targetTokens') : undefined;
  return above === undefined || target === undefined ? null : { aboveTokens: above, targetTokens: target };
}

/**
 * A rejected configuration leaves compaction alone rather than half-applying it: the caller stays
 * inert and reports the diagnostic.
 */
export function loadConfig(agentDir: string): { config?: Config; diagnostic?: string } {
  const path = configPath(agentDir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: defaults() };
    return { diagnostic: `${path}: ${String(error)}; compaction stays stock Pi` };
  }
  try {
    return { config: parse(JSON.parse(text)) };
  } catch (error) {
    return { diagnostic: `${path}: ${String(error)}; compaction stays stock Pi` };
  }
}

/**
 * The persisted shape: no absent keys, so a reload reads back exactly what was written.
 *
 * `redistill` is the one key that is omitted rather than written as `null`, because 0.2.x rejects any
 * key it does not know — and rejects the whole file, taking the summarizer model and the thinking
 * level with it. An absent key already reads back as off, so omitting it costs nothing here.
 */
function toRaw(config: Config): Record<string, unknown> {
  return {
    enabled: config.enabled,
    summarizerModel: config.summarizerModel ?? null,
    fallbackModel: config.fallbackModel ?? null,
    thinking: config.thinking,
    keptWindowTokens: config.keptWindowTokens,
    ...(config.redistill ? { redistill: config.redistill } : {}),
  };
}

/** The same validation the file goes through, for a configuration assembled by the command. */
export function validateConfig(config: Config): string | undefined {
  try {
    parse(toRaw(config));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Write the configuration, or refuse.
 *
 * `redistill` is file-only: the command surface cannot set it, so a save that dropped a value the
 * parse did not adopt would destroy something the user can only restore by hand, with nothing said.
 * A file carrying a `redistill` object this configuration does not carry is therefore left alone and
 * the save throws, which the command reports as a refused change.
 */
export function saveConfig(agentDir: string, config: Config): void {
  const path = configPath(agentDir);
  const raw = toRaw(config);
  const onDisk = readRedistill(path);
  if (onDisk !== undefined && raw.redistill === undefined) {
    throw new Error(
      `refusing to rewrite ${path}: it carries a redistill (${JSON.stringify(onDisk)}) that this `
      + 'configuration does not adopt, and redistill cannot be set from /compaction. Complete it with '
      + 'both aboveTokens and targetTokens, or remove it, and try again.',
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}

/** The `redistill` object the file on disk carries, or undefined when it carries no object. */
function readRedistill(path: string): unknown {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { redistill?: unknown };
    return typeof parsed.redistill === 'object' && parsed.redistill !== null ? parsed.redistill : undefined;
  } catch {
    return undefined;
  }
}

export function effective(config: Config): Effective {
  return {
    enabled: config.enabled,
    keptWindowTokens: config.keptWindowTokens,
    redistill: config.redistill,
    tuple: { model: config.summarizerModel, thinking: config.thinking },
    fallbackModel: config.fallbackModel,
  };
}
