import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Mode = 'native' | 'count_only' | 'lines';
export interface Config {
  grouping: boolean;
  default: Mode;
  tools: Record<string, Mode>;
  bash: { maxCommandChars: number; outputLines: number };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function mode(value: unknown): asserts value is Mode {
  if (value !== 'native' && value !== 'count_only' && value !== 'lines') throw new Error('mode must be native, count_only, or lines');
}

export function loadConfig(agentDir: string): { config?: Config; diagnostic?: string } {
  const path = join(agentDir, 'extensions', 'pi-minimal-display', 'config.json');
  const defaults: Config = {
    grouping: true, default: 'count_only',
    tools: { read: 'count_only', grep: 'count_only', find: 'count_only', ls: 'count_only', bash: 'lines', edit: 'lines', write: 'lines', ask_user_question: 'native', plan_mode_question: 'native', plan_mode_complete: 'native' },
    bash: { maxCommandChars: 120, outputLines: 0 },
  };
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(readFileSync(path, 'utf8')), 'config');
    for (const key of Object.keys(raw)) {
      if (!['grouping', 'hideThinking', 'default', 'tools', 'bash'].includes(key)) throw new Error(`unknown field ${key}`);
    }
    if ('grouping' in raw && typeof raw.grouping !== 'boolean') throw new Error('grouping must be boolean');
    if ('hideThinking' in raw && typeof raw.hideThinking !== 'boolean') throw new Error('hideThinking must be boolean');
    if ('default' in raw) mode(raw.default);
    if ('tools' in raw) {
      for (const [name, value] of Object.entries(record(raw.tools, 'tools'))) {
        if (!name.trim() || name !== name.trim() || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error(`invalid tool name ${name}`);
        mode(value);
      }
    }
    if ('bash' in raw) {
      for (const [key, value] of Object.entries(record(raw.bash, 'bash'))) {
        const min = key === 'maxCommandChars' ? 8 : 0;
        const max = key === 'maxCommandChars' ? 500 : 50;
        if (!['maxCommandChars', 'outputLines'].includes(key) || typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
          throw new Error(`bash.${key} must be an integer from ${min} to ${max}`);
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: defaults };
    return { diagnostic: `${path}: ${String(error)}; using native display` };
  }
  const { hideThinking: _ignored, ...settings } = raw as Partial<Config> & { hideThinking?: boolean };
  return { config: { ...defaults, ...settings, tools: { ...defaults.tools, ...settings.tools }, bash: { ...defaults.bash, ...settings.bash } } };
}
