import { realpathSync } from "node:fs";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export interface DescendantEntry {
  session: SessionInfo;
  /** 1 for direct children, 2 for grandchildren, and so on. */
  depth: number;
}

/**
 * Resolve to the canonical (real) path, falling back to the raw value when the
 * target does not exist. Mirrors the host's own path canonicalization so
 * parent/child links compare equal across symlinks.
 */
export function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Collect every descendant of `rootPath`, depth-first. Cycles in
 * `parentSessionPath` terminate instead of recursing forever.
 */
export function collectDescendants(sessions: SessionInfo[], rootPath: string): DescendantEntry[] {  const childrenByParent = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (!session.parentSessionPath) continue;
    const parent = canonicalize(session.parentSessionPath);
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(session);
    else childrenByParent.set(parent, [session]);
  }

  const root = canonicalize(rootPath);
  const visited = new Set<string>([root]);
  const found: DescendantEntry[] = [];

  const walk = (parent: string, depth: number): void => {
    for (const session of childrenByParent.get(parent) ?? []) {
      const path = canonicalize(session.path);
      if (visited.has(path)) continue;
      visited.add(path);
      found.push({ session, depth });
      walk(path, depth + 1);
    }
  };
  walk(root, 1);

  return found;
}

export interface CascadePlan {
  /** Paths to remove, selected node first. Empty when the delete is refused. */
  targets: string[];
  /** Set when the selected node is the live session, which must never be deleted. */
  blocked: boolean;
  /** Descendants kept back because they are the live session. */
  skipped: number;
}

/**
 * Decide what a cascade from `selected` may remove. The active session survives
 * both as the selected node and as any descendant of it, matching the rule Pi's
 * own single delete enforces.
 */
export function planCascade(
  sessions: SessionInfo[],
  selected: string,
  isCurrent: (path: string) => boolean,
): CascadePlan {
  if (isCurrent(selected)) return { targets: [], blocked: true, skipped: 0 };
  const descendants = collectDescendants(sessions, selected).map((d) => d.session.path);
  const deletable = descendants.filter((path) => !isCurrent(path));
  return {
    targets: [selected, ...deletable],
    blocked: false,
    skipped: descendants.length - deletable.length,
  };
}
