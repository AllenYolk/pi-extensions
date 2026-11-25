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
export function collectDescendants(sessions: SessionInfo[], rootPath: string): DescendantEntry[] {
  const childrenByParent = new Map<string, SessionInfo[]>();
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
  const owners = [rootPath, ...collectDescendants(sessions, rootPath).map((d) => d.session.path)];
  return [...sessions, ...(await collectOwnedTaskSessions(owners, listDir, isHeld))];
}

async function collectOwnedTaskSessions(
  roots: string[],
  listDir: (dir: string) => Promise<SessionInfo[]>,
  isHeld: (path: string) => boolean,
): Promise<SessionInfo[]> {
  const owners = [...roots];
  const seen = new Set(roots.map(canonicalize));
  const hidden: SessionInfo[] = [];
  for (const owner of owners) {
    if (isHeld(owner)) continue;
    const dir = taskDir(owner);
    const realDir = canonicalize(dir);
    // Another owner's tasks (including the active session's) are not ours through a symlink.
    if (realDir !== dir && realDir !== taskDir(join(canonicalize(dirname(owner)), basename(owner)))) continue;
    for (const task of await listDir(dir)) {
      const path = canonicalize(task.path);
      if (canonicalize(dirname(task.path)) !== realDir || dirname(path) !== realDir) continue;
      if (seen.has(path) || isHeld(task.path)) continue;
      seen.add(path);
      hidden.push({ ...task, path, parentSessionPath: owner });
      owners.push(path);
    }
  }
  return hidden;
}

export async function planBatchDeletion(
  listed: SessionInfo[],
  selected: ReadonlySet<string>,
  listDir: (dir: string) => Promise<SessionInfo[]>,
  isCurrent: (path: string) => boolean,
) {
  const marked = new Map<string, SessionInfo>();
  for (const session of listed) {
    const id = canonicalize(session.path);
    // Prefer the real file when both it and a symlink to it are listed.
    if (selected.has(id) && (!marked.has(id) || session.path === id) && !isCurrent(session.path)) {
      marked.set(id, session);
    }
  }
  const visible = [...marked.values()];
  const namedSessions = visible.filter((s) => s.name?.trim());
  const roots = visible.map((s) => s.path);
  const hiddenSessions = await collectOwnedTaskSessions(roots, listDir, isCurrent);
  return {
    targets: [...roots, ...hiddenSessions.map((s) => s.path)],
    visibleSessions: [...namedSessions, ...visible.filter((s) => !s.name?.trim())],
    hiddenSessions,
    visibleCount: visible.length,
    hiddenCount: hiddenSessions.length,
    namedSessions,
  };
}

export type BatchPlan = Awaited<ReturnType<typeof planBatchDeletion>>;

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
