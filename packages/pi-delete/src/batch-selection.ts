import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { canonicalize, collectDescendants } from "./descendants.ts";

export interface BatchRow {
  session: SessionInfo;
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
}

export class BatchSelection {
  readonly #selected = new Map<string, SessionInfo>();
  #visiblePaths?: Set<string>;
  #rows: readonly BatchRow[];
  #anchor?: number;
  cursor: number;
  readonly isCurrent: (path: string) => boolean;

  constructor(rows: readonly BatchRow[], cursor: number, isCurrent: (path: string) => boolean) {
    this.#rows = rows;
    this.cursor = cursor;
    this.isCurrent = isCurrent;
    this.move(0);
  }

  get selected(): ReadonlyMap<string, SessionInfo> {
    return this.#selected;
  }

  get hiddenCount(): number {
    if (!this.#selected.size) return 0;
    const visible = this.#visiblePaths ??= new Set(this.rows.map(({ session }) => canonicalize(session.path)));
    let hidden = 0;
    for (const id of this.#selected.keys()) if (!visible.has(id)) hidden++;
    return hidden;
  }

  refreshSelected(sessions: Iterable<SessionInfo>): void {
    for (const session of sessions) {
      const id = canonicalize(session.path);
      const previous = this.#selected.get(id);
      if (!previous) continue;
      // Keep the freshest metadata, but plan against the real file if it was listed.
      const latest = session.modified >= previous.modified ? session : previous;
      const path = session.path === id || previous.path === id ? id : latest.path;
      this.#selected.set(id, latest.path === path ? latest : { ...latest, path });
    }
  }

  unmark(id: string): void {
    this.#selected.delete(id);
  }

  clear(): void {
    this.#selected.clear();
  }

  get rows(): readonly BatchRow[] {
    return this.#rows;
  }

  get cursorRow(): BatchRow | undefined {
    return this.rows[this.cursor];
  }

  replaceRows(rows: readonly BatchRow[]): void {
    if (rows === this.rows) return;
    this.cancelRange();
    const previous = this.cursorRow?.session.path;
    this.#rows = rows;
    this.#visiblePaths = undefined;
    if (previous !== undefined) {
      let index = rows.findIndex(({ session }) => session.path === previous);
      if (index < 0) {
        const path = canonicalize(previous);
        index = rows.findIndex(({ session }) => canonicalize(session.path) === path);
      }
      if (index >= 0) this.cursor = index;
    }
    this.move(0);
  }

  move(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.rows.length - 1, this.cursor + delta));
  }

  get range(): readonly [number, number] | undefined {
    if (this.#anchor === undefined) return;
    return [Math.min(this.#anchor, this.cursor), Math.max(this.#anchor, this.cursor)];
  }

  startRange(): void {
    if (this.rows.length) this.#anchor = this.cursor;
  }

  cancelRange(): void {
    this.#anchor = undefined;
  }

  markRange(): "active" | undefined {
    const range = this.range;
    if (!range) return;
    this.cancelRange();
    const sessions = this.#selectable(this.rows.slice(range[0], range[1] + 1));
    if (!sessions.size) return "active";
    for (const [id, session] of sessions) {
      if (!this.#selected.has(id)) this.#selected.set(id, session);
    }
  }

  toggleVisible(invert = false): "active" | undefined {
    const sessions = this.#selectable(this.rows);
    if (this.rows.length && !sessions.size) return "active";
    this.#toggleMarks(sessions, invert);
  }

  toggle(subtree: boolean, listed: SessionInfo[]): "active" | undefined {
    const root = this.cursorRow?.session;
    if (!root) return;
    if (this.isCurrent(root.path)) return "active";
    const sessions = new Map([[canonicalize(root.path), root]]);
    if (subtree) {
      // A flat/filtered view may hide intermediate links, but only visible rows are marked.
      const descendants = new Set(collectDescendants(listed, root.path).map(({ session }) => canonicalize(session.path)));
      for (const { session } of this.rows) {
        const child = canonicalize(session.path);
        if (descendants.has(child) && !this.isCurrent(session.path) && (!sessions.has(child) || session.path === child)) {
          sessions.set(child, session);
        }
      }
    }
    this.#toggleMarks(sessions);
  }

  #selectable(rows: readonly BatchRow[]): Map<string, SessionInfo> {
    const sessions = new Map<string, SessionInfo>();
    for (const { session } of rows) {
      if (this.isCurrent(session.path)) continue;
      const id = canonicalize(session.path);
      if (!sessions.has(id) || session.path === id) sessions.set(id, session);
    }
    return sessions;
  }

  #toggleMarks(sessions: Map<string, SessionInfo>, invert = false): void {
    const unmarkAll = !invert && [...sessions.keys()].every((id) => this.#selected.has(id));
    for (const [id, session] of sessions) {
      if (unmarkAll) this.#selected.delete(id);
      else if (!this.#selected.has(id)) this.#selected.set(id, session);
      else if (invert) this.#selected.delete(id);
    }
  }
}
