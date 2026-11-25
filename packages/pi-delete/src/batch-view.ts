import { basename } from "node:path";
import { SessionManager, type SessionInfo, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { BatchRow, BatchSelection } from "./batch-selection.ts";
import { deleteSessionFiles } from "./delete-sessions.ts";
import { canonicalize, planBatchDeletion, type BatchPlan } from "./descendants.ts";

interface BatchPicker {
  scope: "current" | "all";
  sortMode: "threaded" | "recent" | "relevance";
  nameFilter: "all" | "named";
  query: string;
  rows(): readonly BatchRow[];
  listed(): SessionInfo[];
  requestRender(): void;
  refreshAfterDelete(gone: ReadonlySet<string>): Promise<void>;
  close(): void;
}

type Phase = { kind: "list" | "planning" | "deleting" | "closed" }
  | { kind: "confirm"; plan: BatchPlan; offset: number };

function clean(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim();
}

function label(session: SessionInfo): string {
  if (session.name?.trim()) return `[named] ${clean(session.name) || "(empty name)"}`;
  return clean(session.firstMessage) || "(empty)";
}

function age(modified: Date): string {
  const minutes = Math.floor((Date.now() - modified.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

// Leave room for the picker borders, status/footer and the confirmation heading.
function pageSize(): number {
  return Math.max(1, Math.min(10, (process.stdout.rows ?? 24) - 12));
}

export class BatchView implements Component {
  readonly #theme: Theme;
  readonly #selection: BatchSelection;
  readonly #picker: BatchPicker;
  #phase: Phase = { kind: "list" };
  #status?: { text: string; error: boolean };

  constructor(theme: Theme, selection: BatchSelection, picker: BatchPicker) {
    this.#theme = theme;
    this.#selection = selection;
    this.#picker = picker;
  }

  invalidate(): void {}

  dispose(): void {
    this.#phase = { kind: "closed" };
  }

  render(width: number): string[] {
    if (width < 1) return [];
    const theme = this.#theme;
    const state = this.#selection;
    const phase = this.#phase;
    const page = pageSize();
    const lines: string[] = [];
    if (phase.kind === "confirm") {
      const { plan } = phase;
      const total = plan.targets.length;
      const offset = Math.min(phase.offset, Math.max(0, total - page));
      lines.push(theme.bold(`Delete ${total} session${total === 1 ? "" : "s"}${plan.hiddenCount ? ` (${plan.hiddenCount} hidden)` : ""}?`));
      lines.push(theme.fg("muted", `${plan.visibleCount} listed · ${plan.hiddenCount} hidden`));
      if (plan.namedSessions.length) lines.push(theme.fg("error", "Warning: named sessions will be deleted"));
      for (let i = offset; i < Math.min(offset + page, total); i++) {
        if (i < plan.visibleCount) {
          const session = plan.visibleSessions[i]!;
          lines.push(i < plan.namedSessions.length ? theme.fg("error", label(session)) : label(session));
        } else {
          lines.push(theme.fg("dim", `[hidden] ${label(plan.hiddenSessions[i - plan.visibleCount]!)}`));
        }
      }
      if (total > page) lines.push(theme.fg("muted", `${offset + 1}–${Math.min(offset + page, total)} / ${total}`));
      lines.push(theme.fg("muted", "↑↓/PgUp/PgDn review · Enter delete · Esc back"));
    } else {
      // Keep the cursor against the old list until Pi's incremental refresh finishes.
      if (phase.kind !== "deleting") state.replaceRows(this.#picker.rows());
      const { scope, sortMode, nameFilter, query } = this.#picker;
      lines.push(theme.bold(`Batch Delete · ${state.selected.size} selected`));
      const sort = sortMode === "threaded" ? "Threaded" : sortMode === "recent" ? "Recent" : "Fuzzy";
      lines.push(theme.fg("muted", `${scope === "current" ? "Current Folder" : "All Folders"} · ${sort} · ${nameFilter === "named" ? "Named" : "All Names"}${query ? ` · Search: ${clean(query)}` : ""}`));
      if (this.#status) lines.push(theme.fg(this.#status.error ? "error" : "accent", this.#status.text));
      else if (phase.kind === "planning") lines.push(theme.fg("muted", "Planning deletion…"));
      else if (phase.kind === "deleting") lines.push(theme.fg("muted", "Deleting sessions and refreshing…"));
      if (!state.rows.length) lines.push(theme.fg("muted", "No matching sessions"));
      const start = Math.max(0, Math.min(state.cursor - Math.floor(page / 2), state.rows.length - page));
      for (let i = start; i < Math.min(start + page, state.rows.length); i++) {
        const { session, depth, isLast, ancestorContinues } = state.rows[i]!;
        const live = state.isCurrent(session.path);
        const mark = live ? "[-]" : state.selected.has(canonicalize(session.path)) ? "[x]" : "[ ]";
        const tree = depth ? ancestorContinues.slice(1).map((continues) => continues ? "│  " : "   ").join("") + (isLast ? "└─ " : "├─ ") : "";
        const left = `${i === state.cursor ? "› " : "  "}${mark} ${tree}${label(session)}`;
        const meta = `${session.messageCount} msgs · ${age(session.modified)}`;
        const maxLeft = width - visibleWidth(meta) - 1;
        const text = truncateToWidth(left, maxLeft > 4 ? maxLeft : width, "…");
        const styled = theme.fg(i === state.cursor ? "accent" : live ? "dim" : session.name?.trim() ? "warning" : "text", text);
        lines.push(maxLeft > 4 ? styled + " ".repeat(width - visibleWidth(text) - visibleWidth(meta)) + theme.fg("dim", meta) : styled);
      }
      if (state.rows.length > page) lines.push(theme.fg("muted", `${state.cursor + 1} / ${state.rows.length}`));
      lines.push(theme.fg("muted", "↑↓ move · Space toggle · t subtree · d/Enter delete · Esc back"));
    }
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  handleInput(key: string): void {
    const phase = this.#phase;
    if (phase.kind !== "list" && phase.kind !== "confirm") return;
    const page = pageSize();
    const delta = matchesKey(key, "up") ? -1 : matchesKey(key, "down") ? 1
      : matchesKey(key, "pageUp") ? -page : matchesKey(key, "pageDown") ? page : 0;
    const escape = matchesKey(key, "escape");
    const enter = matchesKey(key, "enter");
    if (phase.kind === "confirm") {
      if (escape) this.#phase = { kind: "list" };
      else if (enter) void this.#delete(phase.plan);
      else if (delta) {
        const lastOffset = Math.max(0, phase.plan.targets.length - page);
        phase.offset = Math.max(0, Math.min(Math.min(phase.offset, lastOffset) + delta, lastOffset));
      }
      else return;
    } else {
      const state = this.#selection;
      state.replaceRows(this.#picker.rows());
      if (escape) return this.#picker.close();
      if (delta) state.move(delta);
      else if (matchesKey(key, "space") || key === "t") {
        this.#status = state.toggle(key === "t", this.#picker.listed()) === "active"
          ? { text: "Cannot select the currently active session", error: true } : undefined;
      } else if (key === "d" || enter) {
        if (state.selected.size) void this.#confirm();
        else this.#status = { text: "Select a session first (Space or t)", error: false };
      } else return;
    }
    this.#picker.requestRender();
  }

  async #confirm(): Promise<void> {
    const phase = this.#phase = { kind: "planning" };
    this.#status = undefined;
    try {
      const plan = await planBatchDeletion(this.#picker.listed(), this.#selection.selected,
        (dir) => SessionManager.listAll(dir), this.#selection.isCurrent);
      if (this.#phase !== phase) return;
      if (plan.targets.length) this.#phase = { kind: "confirm", plan, offset: 0 };
      else {
        this.#phase = { kind: "list" };
        this.#status = { text: "No selected sessions could be found", error: true };
      }
    } catch (error) {
      if (this.#phase !== phase) return;
      this.#phase = { kind: "list" };
      this.#status = { text: `Could not plan deletion: ${clean(String(error))}`, error: true };
    }
    this.#picker.requestRender();
  }

  async #delete(plan: BatchPlan): Promise<void> {
    const phase = this.#phase = { kind: "deleting" };
    const ids = new Map(plan.visibleSessions.map(({ path }) => [path, canonicalize(path)]));
    let summary = "Could not delete sessions";
    try {
      const failures = deleteSessionFiles(plan.targets);
      const gone = new Set(plan.targets);
      for (const { path } of failures) gone.delete(path);
      for (const [path, id] of ids) if (gone.has(path)) this.#selection.selected.delete(id);
      const hidden = plan.hiddenSessions.filter(({ path }) => gone.has(path)).length;
      summary = `Deleted ${gone.size} session${gone.size === 1 ? "" : "s"}${hidden ? ` (${hidden} hidden)` : ""}`;
      const firstFailure = failures[0];
      if (firstFailure) summary += ` · failed ${failures.length}: ${clean(basename(firstFailure.path))} — ${clean(firstFailure.error)}`;
      await this.#picker.refreshAfterDelete(gone);
      if (this.#phase !== phase) return;
      this.#status = { text: summary, error: failures.length > 0 };
    } catch (error) {
      if (this.#phase !== phase) return;
      this.#status = { text: `${summary} · ${clean(String(error))}`, error: true };
    }
    this.#phase = { kind: "list" };
    this.#picker.requestRender();
  }
}
