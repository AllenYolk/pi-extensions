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

/** The file as written. */
export interface Config {
  enabled: boolean;
  /** `null` — the default — is the conversation model. */
  summarizerModel: string | null;
  thinking: ThinkingLevel;
  keptWindowTokens: number;
}

/** What a compaction actually runs with. */
export interface Effective {
  enabled: boolean;
  tuple: Tuple;
  keptWindowTokens: number;
}

const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const FIELDS = ['enabled', 'summarizerModel', 'thinking', 'keptWindowTokens'];
const MAX_TOKENS = 1_000_000;

export const defaults = (): Config => ({
  enabled: false,
  summarizerModel: null,
  thinking: DEFAULT_THINKING,
  keptWindowTokens: DEFAULT_KEPT_WINDOW_TOKENS,
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
  return {
    enabled: config.enabled,
    summarizerModel: config.summarizerModel ?? null,
    thinking: config.thinking,
    keptWindowTokens: config.keptWindowTokens,
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

export function saveConfig(agentDir: string, config: Config): void {
  const path = configPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(toRaw(config), null, 2)}\n`);
}

export function effective(config: Config): Effective {
  return {
    enabled: config.enabled,
    keptWindowTokens: config.keptWindowTokens,
    tuple: { model: config.summarizerModel, thinking: config.thinking },
  };
}
