import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { canonicalize, collectDescendants } from "./descendants.ts";

export interface BatchRow {
  session: SessionInfo;
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
}

export class BatchSelection {
  readonly selected = new Set<string>();
  cursor: number;
  rows: readonly BatchRow[];
  readonly isCurrent: (path: string) => boolean;

  constructor(rows: readonly BatchRow[], cursor: number, isCurrent: (path: string) => boolean) {
    this.rows = rows;
    this.cursor = cursor;
    this.isCurrent = isCurrent;
    this.move(0);
  }

  get cursorRow(): BatchRow | undefined {
    return this.rows[this.cursor];
  }

  replaceRows(rows: readonly BatchRow[]): void {
    if (rows === this.rows) return;
    const previous = this.cursorRow?.session.path;
    this.rows = rows;
    if (previous !== undefined) {
      const path = canonicalize(previous);
      const index = rows.findIndex(({ session }) => canonicalize(session.path) === path);
      if (index >= 0) this.cursor = index;
    }
    this.move(0);
  }

  move(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.rows.length - 1, this.cursor + delta));
  }

  toggle(subtree: boolean, listed: SessionInfo[]): "active" | undefined {
    const path = this.cursorRow?.session.path;
    if (!path) return;
    if (this.isCurrent(path)) return "active";
    const root = canonicalize(path);
    const paths = new Set([root]);
    if (subtree) {
      // A flat/filtered view may hide intermediate links, but only visible rows are marked.
      const descendants = new Set(collectDescendants(listed, path).map(({ session }) => canonicalize(session.path)));
      for (const { session } of this.rows) {
        const child = canonicalize(session.path);
        if (descendants.has(child) && !this.isCurrent(session.path)) paths.add(child);
      }
    }
    const unmark = [...paths].every((p) => this.selected.has(p));
    for (const p of paths) {
      if (unmark) this.selected.delete(p);
      else this.selected.add(p);
    }
  }
}
