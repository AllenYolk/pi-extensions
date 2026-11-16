/**
 * Deterministic scoring of a compaction summary. No model, no network, no host: everything here is a
 * pure function of the summary text and the range that was summarised.
 */

/**
 * The nine headings the host's summarization prompt asks for, in the order it asks for them.
 * A summary that drops one has dropped a section the host's own prompt required.
 */
export const SECTIONS = [
  '## Goal',
  '## Constraints & Preferences',
  '## Progress',
  '### Done',
  '### In Progress',
  '### Blocked',
  '## Key Decisions',
  '## Next Steps',
  '## Critical Context',
] as const;

/**
 * A file path: at least one directory separator, and a final segment carrying a file extension that
 * starts with a letter. The extension rule is what keeps `minimax-cn/MiniMax-M3.1-Flash` and
 * `release/0.9` — model names and branch names, which a summary legitimately repeats — out of a
 * metric about invented files.
 *
 * shortcut: a bare filename with no directory (`manifest.sidecar`) is not counted. It would catch
 * more fabrications and also every `Node.js` and `e.g.` in prose; widen it if a real summary is
 * caught inventing extension-less names that this misses.
 */
const PATH = /(?:[A-Za-z0-9_~.@+-]+\/)+[A-Za-z0-9_~.@+-]*\.[A-Za-z][A-Za-z0-9]*/g;

/** The distinct file paths a text names, in the order they first appear. URLs are not paths. */
export function pathsIn(text: string): string[] {
  const withoutUrls = text.replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/g, ' ');
  return [...new Set(withoutUrls.match(PATH) ?? [])];
}

/**
 * The paths a summary names that the summarised range does not contain — the count of things the
 * summarizer invented. The range is the text the summarizer was given, so a path that only occurs
 * in a part of a tool result the host truncated away counts as invented, which is the honest
 * reading: the summarizer could not have seen it.
 *
 * Containment is a segment-boundary suffix test over the paths the range names, not
 * `String.includes` and not whole-token equality.
 *
 * A substring test makes a path count as present whenever it is a prefix of a *different* path in
 * the range, so a range naming `src/cache/spill.rs2` would clear a summary that invented
 * `src/cache/spill.rs` — the failure this metric exists to catch. Whole-token equality goes the
 * other way: a `--session` run's range is raw session text carrying absolute tool paths, so
 * equality counts an abbreviated `src/index/manifest.ts` as invented when the range named
 * `/home/u/proj/src/index/manifest.ts`, and the column stops meaning "paths the summarizer made up".
 *
 * So a path is present when the range names it, or names it at the end of a longer path whose
 * remainder ends at a separator. That accepts an abbreviation of a path that was there and still
 * refuses a prefix of a longer filename.
 */
export function fabricatedPaths(summary: string, range: string): string[] {
  const present = pathsIn(range);
  return pathsIn(summary)
    .filter((path) => !present.some((token) => token === path || token.endsWith(`/${path}`)));
}

/** A declared fact the summarised range contains and a continuing model would be hurt by losing. */
export interface Probe {
  id: string;
  kind: 'literal' | 'regex';
  value: string;
}

/** Whether a probe occurs in a text. A literal is matched exactly; a regex is matched as written. */
export function probeMatches(probe: Probe, text: string): boolean {
  return probe.kind === 'literal' ? text.includes(probe.value) : new RegExp(probe.value).test(text);
}

export interface ProbeScore {
  count: number;
  total: number;
  lost: string[];
}

/** How many declared probes a summary carried, and which ones it dropped. */
export function scoreProbes(summary: string, probes: readonly Probe[]): ProbeScore {
  const lost = probes.filter((probe) => !probeMatches(probe, summary)).map((probe) => probe.id);
  return { count: probes.length - lost.length, total: probes.length, lost };
}

export interface SectionScore {
  count: number;
  present: string[];
  missing: string[];
}

/**
 * How many of the nine sections a summary carries.
 *
 * The heading level is not matched: the host's prompt asks for `## Progress` and `### Done`, but a
 * summary that writes them all at one level has still written every section, and scoring it as
 * missing would measure formatting rather than content.
 */
export function countSections(summary: string): SectionScore {
  const headings = summary.split('\n')
    .map((line) => /^\s{0,3}(#{1,6})\s+(.*?)\s*$/.exec(line)?.[2])
    .filter((text): text is string => text !== undefined)
    .map((text) => text.toLowerCase());
  const present: string[] = [];
  const missing: string[] = [];
  for (const section of SECTIONS) {
    const wanted = section.replace(/^#+\s*/, '').toLowerCase();
    (headings.includes(wanted) ? present : missing).push(section);
  }
  return { count: present.length, present, missing };
}
