/**
 * Measure a compaction: one fixed input, several summarizer configurations, one scorer.
 *
 * Two modes:
 *
 *   node eval/harness.ts --score <summary.md> ...        offline, no credentials, no request
 *   node eval/harness.ts --arm <provider/model>@<level> --arm ...   live, costs money, never in CI
 *
 * The live mode is the only thing here that opens a socket, and it is unreachable without `--arm`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  countSections,
  fabricatedPaths,
  scoreProbes,
  SECTIONS,
} from './score.ts';
import { DEFAULT_FIXTURE, loadFixture, type Fixture } from './input.ts';
import type { ThinkingLevel } from '../src/config.ts';

/**
 * The levels `src/config.ts` accepts, in its order.
 *
 * An arm's level is refused against these rather than passed to `summarizerThinkingLevel`, which
 * clamps whatever it does not recognise to the model's first available level — typically `off`. A
 * clamp would measure the arm at a level the operator never asked for and say nothing, and the
 * package's own configuration rejects an unknown level outright.
 */
const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** What one arm produced. A summary scored offline has only a name and its text. */
export interface ArmRecord {
  arm: string;
  model?: string;
  /** The level that ran, after the host's clamp. */
  thinking?: string;
  requestedThinking?: string;
  /**
   * Every response group the attempt produced, in order; `null` for a group whose response carried
   * no stop reason at all.
   *
   * A split turn makes **two** summarization requests through the same stream function and the host
   * concatenates both into one summary, so a clean second group says nothing about a partial first
   * one. This is the same shape `src/index.ts` checks before it persists anything, and the same
   * reason: reading only the last group would score a half-written summary as a clean one.
   */
  stopReasons?: (string | null)[];
  wallMs?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cost?: number;
  summary: string;
  error?: string;
}

export interface SummaryScore {
  sections: { count: number; total: number; missing: string[] };
  fabricated: string[];
  probes: { count: number; total: number; lost: string[] };
}

export interface ScoredArm extends ArmRecord {
  score: SummaryScore;
  /** Output tokens against the control arm — the first arm on the command line. */
  outputDelta?: number;
}

export interface RunRecord {
  fixture: string;
  session: string;
  keptWindowTokens: number;
  rangeChars: number;
  probes: number;
  arms: ScoredArm[];
}

class UsageError extends Error {}

interface Options {
  arms: string[];
  scores: string[];
  fixture?: string;
  session?: string;
  json: boolean;
  out?: string;
  /** `--help` was asked for. Usage on stdout and a zero status — help is not one of the failures. */
  help: boolean;
}

const USAGE = `usage:
  node eval/harness.ts --score <summary.md|run.json> [--score ...] [--fixture <manifest.json>] [--json]
  node eval/harness.ts --arm <provider/model>@<thinking> --arm <provider/model>@<thinking>
                       [--fixture <manifest.json>] [--session <path>] [--out <dir>] [--json]

  --score   score a summary that already exists. No credentials, no request.
  --arm     summarise the fixture with this model and thinking level. Live; costs money.
  --fixture the fixture manifest. Defaults to ${DEFAULT_FIXTURE}
  --session read the session from this path instead of the fixture's own. Never committed.
  --out     where a live run writes run.json and one file per summary. Defaults to ./work/.
  --json    emit the run record instead of the table.

Exit status: 0 all arms stopped cleanly, 1 an arm did not stop with "stop", 2 bad usage.`;

/** Parse the command line. Anything unrecognised is refused rather than ignored. */
export function parseArgs(argv: string[]): Options {
  const options: Options = { arms: [], scores: [], json: false, help: false };
  const value = (flag: string, index: number): string => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    switch (flag) {
      case '--help': case '-h': return { ...options, help: true };
      case '--json': options.json = true; break;
      case '--arm': options.arms.push(value(flag, index++)); break;
      case '--score': options.scores.push(value(flag, index++)); break;
      case '--fixture': options.fixture = resolve(value(flag, index++)); break;
      case '--session': options.session = resolve(value(flag, index++)); break;
      case '--out': options.out = resolve(value(flag, index++)); break;
      default: throw new UsageError(`unknown argument ${flag}\n\n${USAGE}`);
    }
  }
  if (options.arms.length > 0 && options.scores.length > 0) {
    throw new UsageError('--arm and --score are different modes; pass one or the other');
  }
  if (options.arms.length === 0 && options.scores.length === 0) {
    throw new UsageError(`nothing to do\n\n${USAGE}`);
  }
  if (options.arms.length === 1) {
    throw new UsageError('a comparison needs at least two arms');
  }
  for (const arm of options.arms) {
    if (!/^[^@\s]+\/[^@\s]+@[a-z]+$/.test(arm)) {
      throw new UsageError(`--arm ${arm} must be <provider/model>@<thinking>`);
    }
    const level = arm.slice(arm.lastIndexOf('@') + 1);
    if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
      throw new UsageError(
        `--arm ${arm} names a thinking level that does not exist: ${level}\n`
        + `thinking must be one of ${THINKING_LEVELS.join(', ')}`,
      );
    }
  }
  // A session override would change the range a summary is scored against, which is the one thing a
  // summary that already exists cannot be re-scored under. Neither flag has anything to act on.
  if (options.scores.length > 0 && options.session !== undefined) {
    throw new UsageError('--session applies to a live run; a scored summary is scored against its fixture');
  }
  if (options.scores.length > 0 && options.out !== undefined) {
    throw new UsageError('--out applies to a live run; scoring writes nothing');
  }
  return options;
}

/** Score every arm against the same range, and measure each one's length against the control arm. */
export function scoreArms(fixture: Fixture, arms: readonly ArmRecord[]): ScoredArm[] {
  const scored = arms.map((arm) => ({ ...arm, score: scoreSummary(arm.summary, fixture) }));
  const control = scored[0]?.outputTokens;
  return scored.map((arm) => ({
    ...arm,
    ...(control !== undefined && arm.outputTokens !== undefined ? { outputDelta: arm.outputTokens - control } : {}),
  }));
}

function scoreSummary(summary: string, fixture: Fixture): SummaryScore {
  const sections = countSections(summary);
  const probes = scoreProbes(summary, fixture.probes);
  return {
    sections: { count: sections.count, total: SECTIONS.length, missing: sections.missing },
    fabricated: fabricatedPaths(summary, fixture.range),
    probes: { count: probes.count, total: probes.total, lost: probes.lost },
  };
}

/**
 * An arm is clean only when **every** response group it produced stopped with `stop`, and it produced
 * at least one. A split turn's groups are all checked, and an attempt whose responses were never
 * observed is not a clean one — the same two rules the hook applies before it persists a summary.
 *
 * A summary passed to `--score` was never a response, so it has no groups and cannot fail this.
 */
export function exitCodeFor(arms: readonly ScoredArm[]): number {
  const unclean = (arm: ScoredArm) => arm.stopReasons !== undefined
    && (arm.stopReasons.length === 0 || arm.stopReasons.some((reason) => reason !== 'stop'));
  return arms.some(unclean) ? 1 : 0;
}

const COLUMNS = ['arm', 'stop', 'wall', 'out tok', 'reason tok', 'cost', 'sections', 'fabricated', 'probes', 'Δ out'] as const;

export function renderTable(arms: readonly ScoredArm[]): string {
  const rows = arms.map((arm) => [
    arm.arm,
    arm.stopReasons === undefined ? '—' : stops(arm.stopReasons),
    arm.wallMs === undefined ? '—' : `${(arm.wallMs / 1000).toFixed(1)}s`,
    arm.outputTokens === undefined ? '—' : String(arm.outputTokens),
    arm.reasoningTokens === undefined ? '—' : String(arm.reasoningTokens),
    arm.cost === undefined ? '—' : `$${arm.cost.toFixed(4)}`,
    `${arm.score.sections.count}/${arm.score.sections.total}`,
    String(arm.score.fabricated.length),
    `${arm.score.probes.count}/${arm.score.probes.total}`,
    arm.outputDelta === undefined ? '—' : signed(arm.outputDelta),
  ]);
  // The first column is left-aligned and the rest are right-aligned; widths come from the content, so
  // the same arms always render the same table.
  const widths = COLUMNS.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]!.length)));
  const line = (cells: string[]) => cells
    .map((cell, index) => (index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!)))
    .join('  ')
    .trimEnd();
  return [line([...COLUMNS]), line(widths.map((width) => '-'.repeat(width))), ...rows.map((row) => line(row))].join('\n');
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/** The stop column: every distinct group outcome, so a split turn shows both of its halves. */
const stops = (reasons: readonly (string | null)[]) =>
  reasons.length === 0 ? 'none' : [...new Set(reasons.map((reason) => reason ?? 'no stop reason'))].join(',');

/** Why an arm is not clean, in the hook's terms. Undefined when every group stopped with `stop`. */
function uncleanNote(stopReasons: readonly (string | null)[]): string | undefined {
  if (stopReasons.length === 0) return 'no summarization response was observed at all';
  const unclean = stopReasons.filter((reason) => reason !== 'stop');
  if (unclean.length === 0) return undefined;
  const of = (reason: string | null) => (reason === null ? 'no stop reason' : `"${reason}"`);
  return unclean.length === stopReasons.length
    ? `every summarization response failed to stop with "stop" (${unclean.map(of).join(', ')})`
    : `${unclean.length} of ${stopReasons.length} summarization responses did not stop with "stop" `
      + `(${unclean.map(of).join(', ')}) — a split turn's responses are all checked`;
}

/** A summary file, or a run record a live run wrote — which carries its fixture, its session and its stop reasons. */
function readScored(path: string): { arms: ArmRecord[]; fixture?: string; session?: string } {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.json')) return { arms: [{ arm: basename(path).replace(/\.md$/, ''), summary: text }] };
  const record = JSON.parse(text) as { arms?: unknown; fixture?: unknown; session?: unknown };
  if (!Array.isArray(record.arms)) throw new UsageError(`${path} is not a run record: it has no arms`);
  const arms = record.arms.map((arm) => {
    const { score: _score, outputDelta: _delta, ...rest } = arm as ScoredArm;
    return rest;
  });
  return {
    arms,
    ...(typeof record.fixture === 'string' ? { fixture: record.fixture } : {}),
    ...(typeof record.session === 'string' ? { session: record.session } : {}),
  };
}

async function runLive(fixture: Fixture, arms: string[]): Promise<ArmRecord[]> {
  // Imported here so that scoring a summary never loads a provider, a credential store or a socket.
  const [{ compact, ModelRegistry, ModelRuntime }, { observingStream, summarizerThinkingLevel, hostRetryPolicy }] =
    await Promise.all([
      import('@earendil-works/pi-coding-agent'),
      import('../src/summarizer.ts'),
    ]);
  const registry = new ModelRegistry(await ModelRuntime.create({ allowModelNetwork: false }));
  await registry.refresh();

  const records: ArmRecord[] = [];
  // One arm at a time: two summarizers sharing a machine would measure each other's contention.
  for (const spec of arms) {
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    const requestedThinking = spec.slice(at + 1);
    const separator = name.indexOf('/');
    const model = registry.find(name.slice(0, separator), name.slice(separator + 1));
    const base: ArmRecord = { arm: spec, model: name, requestedThinking, summary: '' };
    if (!model) {
      records.push({ ...base, stopReasons: ['unavailable'], error: `this host does not offer ${name}` });
      continue;
    }
    if (!registry.hasConfiguredAuth(model)) {
      records.push({ ...base, stopReasons: ['unauthenticated'], error: `no configured credentials for ${name}` });
      continue;
    }
    const thinking = summarizerThinkingLevel(model, { model: name, thinking: requestedThinking as never });
    // One entry per response group. The host's retry policy calls the stream function again with the
    // same context, and observingStream replaces that group's entry, so a retried-away failure is not
    // an outcome — while a split turn's two ranges stay separate and both are recorded.
    const outcomes = new Map<object, { stopReason?: string }>();
    const started = performance.now();
    const stopReasons = () => [...outcomes.values()].map((seen) => seen.stopReason ?? null);
    try {
      const result = await compact(
        fixture.prepared, model, undefined, undefined, undefined, undefined, thinking as never,
        observingStream(registry, (group, seen) => { outcomes.set(group, seen); }),
        undefined, hostRetryPolicy({}), undefined, 'pi-compaction-eval',
      );
      const reasons = stopReasons();
      const note = uncleanNote(reasons);
      records.push({
        ...base, thinking, summary: result.summary,
        stopReasons: reasons,
        wallMs: Math.round(performance.now() - started),
        ...usageOf(result.usage),
        ...(note ? { error: note } : {}),
      });
    } catch (error) {
      records.push({
        ...base, thinking, stopReasons: stopReasons(),
        wallMs: Math.round(performance.now() - started), error: String(error),
      });
    }
  }
  return records;
}

/**
 * The measurement fields a host response's usage object carries over. A field the host did not
 * report stays absent: `0` output tokens and `$0.0000` are what an arm that was never measured looks
 * like once they are recorded as numbers, and `Δ out` would then be computed against that zero.
 */
export function usageOf(usage: unknown): Pick<ArmRecord, 'outputTokens' | 'reasoningTokens' | 'cost'> {
  const value = (usage ?? {}) as { output?: number; reasoning?: number; cost?: { total?: number } };
  const cost = value.cost?.total;
  return {
    ...(value.output === undefined ? {} : { outputTokens: value.output }),
    ...(value.reasoning === undefined ? {} : { reasoningTokens: value.reasoning }),
    ...(cost === undefined ? {} : { cost }),
  };
}

function writeRun(out: string, record: RunRecord): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  record.arms.forEach((arm, index) => {
    if (arm.summary) writeFileSync(join(out, `${index}-${arm.arm.replace(/[^A-Za-z0-9._@-]+/g, '_')}.md`), arm.summary);
  });
}

export async function main(argv: string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const live = options.scores.length === 0;
  // Everything the operator supplied is loaded here: a missing or malformed fixture, a run record
  // that is not one, a recorded session that has since been deleted, and a manifest whose probes do
  // not occur in its own session are all input errors, and get a line rather than a stack trace.
  let loaded: ReturnType<typeof readScored>[];
  let fixture: Fixture;
  try {
    loaded = live ? [] : options.scores.map(readScored);
    // A recorded run names the fixture **and the session** it ran against, so re-scoring it
    // reproduces the same range without the operator having to remember either. This is what makes
    // `--session` usable: a run over a real session is scored over that session, not over the
    // synthetic fixture, which would turn its real paths into fabrications and its absent probes
    // into losses.
    const recorded = loaded.find((entry) => entry.fixture || entry.session);
    fixture = loadFixture(options.fixture ?? recorded?.fixture ?? DEFAULT_FIXTURE, options.session ?? recorded?.session);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const fixturePath = fixture.manifestPath;
  const arms = scoreArms(fixture, live ? await runLive(fixture, options.arms) : loaded.flatMap((entry) => entry.arms));

  const record: RunRecord = {
    fixture: fixturePath,
    session: fixture.sessionPath,
    keptWindowTokens: fixture.keptWindowTokens,
    rangeChars: fixture.range.length,
    probes: fixture.probes.length,
    arms,
  };

  if (live) {
    const out = options.out ?? join(process.cwd(), 'work', `pi-compaction-eval-${stamp()}`);
    writeRun(out, record);
    console.error(`wrote ${join(out, 'run.json')}`);
  }
  if (fixture.dropped.length > 0) {
    console.error(`not scored, absent from the session: ${fixture.dropped.join(', ')}`);
  }

  console.log(options.json ? JSON.stringify(record, null, 2) : renderTable(arms));
  return exitCodeFor(arms);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
