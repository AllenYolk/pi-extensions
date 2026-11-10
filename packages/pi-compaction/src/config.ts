import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The four preset names and the four fields they carry are public configuration from the first
 * release; changing the tuple's shape later is a breaking change (ADR 0003).
 */
export type PresetName = 'fast' | 'balanced' | 'deep';
export type Selection = PresetName | 'off';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** `conversation` is the sentinel for the `deep` preset's summarizer model. */
export const CONVERSATION_MODEL = 'conversation';

export interface Tuple {
  model: string;
  thinking: ThinkingLevel;
  textBudget: number;
  reasoningBudget: number;
}

export const PRESETS: Record<PresetName, Tuple> = {
  fast: { model: 'minimax-cn/minimax-M3.1-Flash', thinking: 'off', textBudget: 6_000, reasoningBudget: 0 },
  balanced: { model: 'minimax-cn/minimax-M3.1-Flash', thinking: 'medium', textBudget: 12_000, reasoningBudget: 8_000 },
  deep: { model: CONVERSATION_MODEL, thinking: 'high', textBudget: 12_000, reasoningBudget: 24_000 },
};

export const DEFAULT_KEPT_WINDOW_TOKENS = 16_000;

/** The file as written: `preset` plus optional per-field overrides of the preset's tuple. */
export interface Config {
  enabled: boolean;
  preset: Selection;
  summarizerModel?: string;
  thinking?: ThinkingLevel;
  textBudget?: number;
  reasoningBudget?: number;
  keptWindowTokens: number;
}

/** What a compaction actually runs with. `tuple` is absent when compaction is stock Pi's. */
export interface Effective {
  enabled: boolean;
  preset: Selection;
  keptWindowTokens: number;
  tuple?: Tuple;
}

const SELECTIONS: Selection[] = ['fast', 'balanced', 'deep', 'off'];
const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const FIELDS = ['enabled', 'preset', 'summarizerModel', 'thinking', 'textBudget', 'reasoningBudget', 'keptWindowTokens'];
const MAX_TOKENS = 1_000_000;

export const defaults = (): Config => ({ enabled: false, preset: 'balanced', keptWindowTokens: DEFAULT_KEPT_WINDOW_TOKENS });

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
  if ('summarizerModel' in record) {
    const model = record.summarizerModel;
    if (typeof model !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(model)) {
      throw new Error('summarizerModel must be "provider/model"');
    }
    config.summarizerModel = model;
  }
  if ('thinking' in record) {
    if (!LEVELS.includes(record.thinking as ThinkingLevel)) throw new Error(`thinking must be ${LEVELS.join(', ')}`);
    config.thinking = record.thinking as ThinkingLevel;
  }
  if ('textBudget' in record) config.textBudget = integer(record.textBudget, 'textBudget', 1);
  if ('reasoningBudget' in record) config.reasoningBudget = integer(record.reasoningBudget, 'reasoningBudget', 0);
  if ('keptWindowTokens' in record) config.keptWindowTokens = integer(record.keptWindowTokens, 'keptWindowTokens', 0);
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
  const raw: Record<string, unknown> = { enabled: config.enabled, preset: config.preset };
  for (const key of ['summarizerModel', 'thinking', 'textBudget', 'reasoningBudget'] as const) {
    if (config[key] !== undefined) raw[key] = config[key];
  }
  raw.keptWindowTokens = config.keptWindowTokens;
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
  const base = { enabled: config.enabled, preset: config.preset, keptWindowTokens: config.keptWindowTokens };
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
