import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

/** Where pi-subagents keeps a session's subagent transcripts: beside the
 *  session file, outside the directory Pi lists, so the picker never shows them. */
export function taskDir(sessionPath: string): string {
  return join(dirname(sessionPath), basename(sessionPath, ".jsonl"), "tasks");
}

/**
 * Add the hidden task sessions owned by `rootPath` and its listed descendants,
 * at any depth, each linked to its owner. Their headers record the parent's ID
 * rather than its path, so the directory is the only reliable link. A held-back
 * owner (the live session) keeps its tasks: its subagents may still write them.
 */
export async function withTaskSessions(
  sessions: SessionInfo[],
  rootPath: string,
  listDir: (dir: string) => Promise<SessionInfo[]>,
  isHeld: (path: string) => boolean = () => false,
): Promise<SessionInfo[]> {
  const pool = [...sessions];
  const owners = [rootPath, ...collectDescendants(sessions, rootPath).map((d) => d.session.path)];
  // Grows while it is walked, so tasks of tasks are scanned too; each level is
  // a deeper directory, so the walk ends.
  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i]!;
    if (isHeld(owner)) continue;
    for (const task of await listDir(taskDir(owner))) {
      pool.push({ ...task, parentSessionPath: owner });
      owners.push(task.path);
    }
  }
  return pool;
}

/**
 * The paths a cascade from `selected` may remove, selected node first. The
 * active session survives both as the selected node (nothing is removed) and
 * as any descendant of it, matching the rule Pi's own single delete enforces.
 */
export function planCascade(
  sessions: SessionInfo[],
  selected: string,
  isCurrent: (path: string) => boolean,
): string[] {
  if (isCurrent(selected)) return [];
  const descendants = collectDescendants(sessions, selected).map((d) => d.session.path);
  return [selected, ...descendants.filter((path) => !isCurrent(path))];
}
