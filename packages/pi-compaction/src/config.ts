import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The four preset names and the four fields they carry are public configuration from the first
 * release; changing the tuple's shape later is a breaking change (ADR 0003).
 */
export type PresetName = 'fast' | 'balanced' | 'deep';
export type Selection = PresetName | 'off';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** The word `/compaction model` and a hand-written config file use for the conversation model. */
export const CONVERSATION_MODEL = 'conversation';

export interface Tuple {
  /** `null` is the conversation model, which is what every preset defaults to. */
  model: string | null;
  thinking: ThinkingLevel;
  textBudget: number;
  reasoningBudget: number;
}

/**
 * All three presets summarise with the conversation model, so the default path never depends on a
 * second provider being signed in. A cheaper summarizer is an explicit choice: `/compaction model
 * provider/model`, or the `summarizerModel` field. The presets differ in thinking level and in the
 * two budgets.
 */
export const PRESETS: Record<PresetName, Tuple> = {
  fast: { model: null, thinking: 'off', textBudget: 6_000, reasoningBudget: 0 },
  balanced: { model: null, thinking: 'medium', textBudget: 12_000, reasoningBudget: 8_000 },
  deep: { model: null, thinking: 'high', textBudget: 12_000, reasoningBudget: 24_000 },
};

export const DEFAULT_KEPT_WINDOW_TOKENS = 16_000;

export const DEFAULT_PRUNE_WINDOW_TOKENS = 16_000;

/**
 * Tools whose results the agent cannot recover by re-running them, so pruning one would be
 * information loss rather than compression. Side-effecting tools (`bash`, `edit`, `write`,
 * `powershell`, `codemode`) and one-shot ones (a subagent's answer, a human's answer, a network
 * response that has since changed). Correctness, not tuning: a pruned result is recoverable only by
 * re-running its tool, and there is no recall tool. Every other tool's results are prunable, so a
 * tool this list does not name is one you have judged re-runnable.
 */
export const DEFAULT_NEVER_PRUNE = [
  'ask_user_question',
  'bash',
  'codemode',
  'edit',
  'fetch_content',
  'powershell',
  'source_check',
  'subagent',
  'web_search',
  'write',
];

/** The file as written: `preset` plus optional per-field overrides of the preset's tuple. */
export interface Config {
  enabled: boolean;
  preset: Selection;
  /** `null` — the default — is the conversation model. */
  summarizerModel: string | null;
  thinking?: ThinkingLevel;
  textBudget?: number;
  reasoningBudget?: number;
  keptWindowTokens: number;
  /** On once the package is enabled, and switchable on its own: pruning is not a summarizer strategy. */
  prune: boolean;
  pruneWindowTokens: number;
  neverPrune: string[];
}

/** What a compaction actually runs with. `tuple` is absent when compaction is stock Pi's. */
export interface Effective {
  enabled: boolean;
  preset: Selection;
  keptWindowTokens: number;
  prune: boolean;
  pruneWindowTokens: number;
  neverPrune: string[];
  tuple?: Tuple;
}

const SELECTIONS: Selection[] = ['fast', 'balanced', 'deep', 'off'];
const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const FIELDS = [
  'enabled', 'preset', 'summarizerModel', 'thinking', 'textBudget', 'reasoningBudget', 'keptWindowTokens',
  'prune', 'pruneWindowTokens', 'neverPrune',
];
const MAX_TOKENS = 1_000_000;

export const defaults = (): Config => ({
  enabled: false,
  preset: 'balanced',
  summarizerModel: null,
  keptWindowTokens: DEFAULT_KEPT_WINDOW_TOKENS,
  prune: true,
  pruneWindowTokens: DEFAULT_PRUNE_WINDOW_TOKENS,
  neverPrune: [...DEFAULT_NEVER_PRUNE],
});

export function configPath(agentDir: string): string {
  return join(agentDir, 'extensions', 'pi-compaction', 'config.json');
}

function integer(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > MAX_TOKENS) {
    throw new Error(`${label} must be an integer from ${min} to ${MAX_TOKENS}`);
  }
  return value;
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
  if ('preset' in record) {
    if (!SELECTIONS.includes(record.preset as Selection)) throw new Error(`preset must be ${SELECTIONS.join(', ')}`);
    config.preset = record.preset as Selection;
  }
  if ('summarizerModel' in record && record.summarizerModel !== null) {
    const model = record.summarizerModel;
    if (model === CONVERSATION_MODEL) {
      config.summarizerModel = null;
    } else if (typeof model !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(model)) {
      throw new Error(`summarizerModel must be "provider/model", "${CONVERSATION_MODEL}" or null`);
    } else {
      config.summarizerModel = model;
    }
  }
  if ('thinking' in record) {
    if (!LEVELS.includes(record.thinking as ThinkingLevel)) throw new Error(`thinking must be ${LEVELS.join(', ')}`);
    config.thinking = record.thinking as ThinkingLevel;
  }
  if ('textBudget' in record) config.textBudget = integer(record.textBudget, 'textBudget', 1);
  if ('reasoningBudget' in record) config.reasoningBudget = integer(record.reasoningBudget, 'reasoningBudget', 0);
  if ('keptWindowTokens' in record) config.keptWindowTokens = integer(record.keptWindowTokens, 'keptWindowTokens', 0);
  if ('prune' in record) {
    if (typeof record.prune !== 'boolean') throw new Error('prune must be boolean');
    config.prune = record.prune;
  }
  if ('pruneWindowTokens' in record) config.pruneWindowTokens = integer(record.pruneWindowTokens, 'pruneWindowTokens', 0);
  if ('neverPrune' in record) {
    const list = record.neverPrune;
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new Error('neverPrune must be an array of non-empty tool names');
    }
    config.neverPrune = [...new Set(list as string[])];
  }
  return config;
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

/** The persisted shape: no absent keys, so a reload reads back exactly what was written. */
function toRaw(config: Config): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    enabled: config.enabled,
    preset: config.preset,
    summarizerModel: config.summarizerModel ?? null,
  };
  for (const key of ['thinking', 'textBudget', 'reasoningBudget'] as const) {
    if (config[key] !== undefined) raw[key] = config[key];
  }
  raw.keptWindowTokens = config.keptWindowTokens;
  raw.prune = config.prune;
  raw.pruneWindowTokens = config.pruneWindowTokens;
  raw.neverPrune = config.neverPrune;
  return raw;
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

export function saveConfig(agentDir: string, config: Config): void {
  const path = configPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(toRaw(config), null, 2)}\n`);
}

export function effective(config: Config): Effective {
  const base = {
    enabled: config.enabled,
    preset: config.preset,
    keptWindowTokens: config.keptWindowTokens,
    prune: config.prune,
    pruneWindowTokens: config.pruneWindowTokens,
    neverPrune: config.neverPrune,
  };
  if (config.preset === 'off') return base;
  const preset = PRESETS[config.preset];
  return {
    ...base,
    tuple: {
      model: config.summarizerModel ?? preset.model,
      thinking: config.thinking ?? preset.thinking,
      textBudget: config.textBudget ?? preset.textBudget,
      reasoningBudget: config.reasoningBudget ?? preset.reasoningBudget,
    },
  };
}
