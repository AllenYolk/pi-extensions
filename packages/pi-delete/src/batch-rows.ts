import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { fuzzyMatch } from "@earendil-works/pi-tui";
import type { BatchRow } from "./batch-selection.ts";
import { canonicalize } from "./descendants.ts";

export interface BatchFilters {
  nameFilter: "all" | "unnamed" | "named";
  sortMode: "threaded" | "recent" | "relevance";
  olderThanDays: 0 | 7 | 30;
  shortOnly: boolean;
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const byRecent = (a: SessionInfo, b: SessionInfo) => b.modified.getTime() - a.modified.getTime();
const searchText = (s: SessionInfo) => `${s.id} ${s.name ?? ""} ${s.allMessagesText} ${s.cwd}`;

function scoreQuery(query: string): (session: SessionInfo) => number | undefined {
  if (query.startsWith("re:")) {
    const pattern = query.slice(3).trim();
    if (!pattern) return () => undefined;
    try {
      const regex = new RegExp(pattern, "i");
      return (session) => {
        const index = searchText(session).search(regex);
        return index < 0 ? undefined : index * 0.1;
      };
    } catch {
      return () => undefined;
    }
  }

  const parts = query.split('"');
  const tokens = (parts.length % 2 ? parts : [query]).flatMap((part, i) =>
    i % 2 ? [{ phrase: true, value: normalize(part) }]
      : part.split(/\s+/).map((value) => ({ phrase: false, value })),
  ).filter(({ value }) => value);
  if (!tokens.length) return () => 0;
  return (session) => {
    const text = searchText(session);
    let normalized: string | undefined;
    let score = 0;
    for (const { phrase, value } of tokens) {
      if (phrase) {
        const index = (normalized ??= normalize(text)).indexOf(value);
        if (index < 0) return undefined;
        score += index * 0.1;
      } else {
        const match = fuzzyMatch(value, text);
        if (!match.matches) return undefined;
        score += match.score;
      }
    }
    return score;
  };
}

function searchRows(sessions: readonly SessionInfo[], query: string, sortMode: BatchFilters["sortMode"]): BatchRow[] {
  const score = scoreQuery(query);
  const matches = sessions.flatMap((session) => {
    const rank = score(session);
    return rank === undefined ? [] : [{ session, rank }];
  });
  matches.sort(sortMode === "recent"
    ? (a, b) => byRecent(a.session, b.session)
    : (a, b) => a.rank - b.rank || byRecent(a.session, b.session));
  return matches.map(({ session }) => ({ session, depth: 0, isLast: true, ancestorContinues: [] }));
}

interface ThreadNode {
  session: SessionInfo;
  latest: number;
  children: ThreadNode[];
  parent?: ThreadNode;
}

function threadedRows(sessions: SessionInfo[]): BatchRow[] {
  const nodes = new Map<string, ThreadNode>();
  for (const session of sessions) {
    const id = canonicalize(session.path);
    if (!nodes.has(id) || session.path === id) {
      nodes.set(id, { session, latest: session.modified.getTime(), children: [] });
    }
  }
  const roots: ThreadNode[] = [];
  for (const node of nodes.values()) {
    const parentPath = node.session.parentSessionPath;
    const parent = parentPath && (nodes.get(parentPath) ?? nodes.get(canonicalize(parentPath)));
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else roots.push(node);
  }

  const visited = new Set<ThreadNode>();
  const byLatest = (a: ThreadNode, b: ThreadNode) => b.latest - a.latest;
  const visit = (node: ThreadNode): void => {
    visited.add(node);
    node.children = node.children.filter((child) => {
      if (visited.has(child)) return false;
      visit(child);
      node.latest = Math.max(node.latest, child.latest);
      return true;
    }).sort(byLatest);
  };
  for (const root of roots) visit(root);
  // A group with a parent cycle has no natural root; cut the back edge.
  for (const node of nodes.values()) {
    if (visited.has(node)) continue;
    // Start on the cycle, not on a descendant that happened to be listed first.
    const lineage = new Set<ThreadNode>();
    let root = node;
    while (root.parent && !lineage.has(root)) {
      lineage.add(root);
      root = root.parent;
    }
    visit(root);
    roots.push(root);
  }

  const rows: BatchRow[] = [];
  const flatten = (siblings: ThreadNode[], ancestorContinues: boolean[]): void => {
    for (const [i, { session, children }] of siblings.entries()) {
      const isLast = i === siblings.length - 1;
      rows.push({ session, depth: ancestorContinues.length, isLast, ancestorContinues });
      if (children.length) flatten(children, [...ancestorContinues, !isLast]);
    }
  };
  flatten(roots.sort(byLatest), []);
  return rows;
}

export function projectBatchRows(sessions: readonly SessionInfo[], filters: BatchFilters, query: string, now = Date.now()) {
  const { nameFilter, olderThanDays, shortOnly, sortMode } = filters;
  const ageMs = olderThanDays * 86_400_000;
  const cutoff = now - ageMs;
  let validUntil = Infinity;
  const filtered: SessionInfo[] = [];
  for (const session of sessions) {
    if (nameFilter !== "all" && Boolean(session.name?.trim()) !== (nameFilter === "named")) continue;
    if (shortOnly && session.messageCount > 2) continue;
    const modified = session.modified.getTime();
    if (olderThanDays && modified >= cutoff) {
      validUntil = Math.min(validUntil, modified + ageMs + 1);
    } else filtered.push(session);
  }
  const trimmed = query.trim();
  const rows = sortMode === "threaded" && !trimmed ? threadedRows(filtered) : searchRows(filtered, trimmed, sortMode);
  return { rows, validUntil };
}
