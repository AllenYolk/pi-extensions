import { homedir } from "node:os";
import { basename, sep } from "node:path";
import { SessionManager, type SessionInfo, type Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, Input, matchesKey, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { projectBatchRows, type BatchFilters } from "./batch-rows.ts";
import type { BatchSelection } from "./batch-selection.ts";
import { deleteSessionFiles } from "./delete-sessions.ts";
import { canonicalize, planBatchDeletion, type BatchPlan } from "./descendants.ts";

interface BatchPicker {
  readonly scope: "current" | "all";
  readonly loading: boolean;
  readonly loadProgress: { loaded: number; total: number } | null;
  readonly loadError?: string;
  toggleScope(): void;
  sortMode: BatchFilters["sortMode"];
  nameFilter: BatchFilters["nameFilter"];
  query: string;
  showPath: boolean;
  listed(): SessionInfo[];
  bothScopes(): Iterable<SessionInfo>;
  requestRender(): void;
  refreshAfterDelete(gone: ReadonlySet<string>): Promise<void>;
  close(): void;
}

type Phase = { kind: "list" | "search" | "planning" | "deleting" | "closed" }
  | { kind: "confirm"; plan: BatchPlan; offset: number };

/** A key and what it does, in Pi's own hint shape. */
type Hint = readonly [key: string, description: string];
interface HintGroup {
  /** Shown once, before the group's first hint, in a column every footer line shares. */
  readonly label?: string;
  readonly accent?: boolean;
  readonly hints: readonly Hint[];
}

/** Grouped by purpose, most useful first: a short terminal drops the tail of the last group. */
const LIST_HINTS: readonly HintGroup[] = [
  { label: "move", hints: [["↑↓", "move"], ["PgUp/PgDn", "page"], ["g/G", "ends"]] },
  { label: "mark", hints: [["Space", "toggle"], ["t", "subtree"], ["v", "range"]] },
  { label: "select", hints: [["a", "toggle all"], ["i", "invert"], ["c", "clear all"]] },
  { label: "review", hints: [["d/Enter", "review"], ["Esc", "back"]] },
  { label: "filter", hints: [["/", "search"], ["Tab", "scope"], ["n", "name"], ["o", "age"], ["m", "length"], ["s", "sort"], ["p", "paths"]] },
];
const RANGE_HINTS: readonly HintGroup[] = [
  { label: "Range anchor", accent: true, hints: [["│", "preview"], ["Space/v", "mark"], ["Esc", "cancel"]] },
];
const SEARCH_HINTS: readonly HintGroup[] = [{ hints: [["Enter/Esc", "back to list"]] }];
const CONFIRM_HINTS: readonly HintGroup[] = [
  { hints: [["↑↓/PgUp/PgDn", "review"], ["Enter", "delete"], ["Esc", "back"]] },
];

/** Pi's own hint styling: a dim key, a muted description, muted separators. */
function styledHint(theme: Theme, [key, description]: Hint): string {
  return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}

/**
 * Lay hint groups out with their labels in one column, so hint text starts at the same place on
 * every line. Groups join a line whole or start their own; only a group too wide for a line of
 * its own continues on indented lines, and hints that no longer fit are dropped from its end
 * rather than cut in half.
 */
function hintLines(theme: Theme, groups: readonly HintGroup[], width: number, maxLines: number): string[] {
  const separator = theme.fg("muted", " · ");
  const labelWidth = Math.max(0, ...groups.map((group) => group.label?.length ?? 0));
  const column = labelWidth ? labelWidth + 1 : 0;
  const indent = " ".repeat(column);
  const lines: string[] = [];
  let line = "";

  for (const group of groups) {
    const label = group.label ?? "";
    const styled = label ? theme.fg(group.accent ? "accent" : "muted", label) : "";
    const head = styled + " ".repeat(column - label.length);
    const inline = styled ? `${styled} ` : "";
    const hints = group.hints.map((hint) => styledHint(theme, hint));
    const whole = (prefix: string) => prefix + hints.join(separator);

    if (line && visibleWidth(`${line}${separator}${whole(inline)}`) <= width) {
      line = `${line}${separator}${whole(inline)}`;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (lines.length >= maxLines) continue;
    if (visibleWidth(whole(head)) <= width) {
      line = whole(head);
      continue;
    }
    for (const [index, hint] of hints.entries()) {
      const prefix = index === 0 ? head : indent;
      const joined = line ? `${line}${separator}${hint}` : prefix + hint;
      if (visibleWidth(joined) <= width) {
        line = joined;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      if (lines.length >= maxLines) break;
      if (visibleWidth(prefix + hint) <= width) line = prefix + hint;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const activeSelectionError = { text: "Cannot select the currently active session", error: true };

/** The spacer, border, spacer, spacer and border `buildBaseLayout` wraps the Batch body in. */
const CONTAINER_ROWS = 5;

/** The rows a footer may use, so a short terminal drops hints instead of overflowing. */
function footerRoom(used: number): number {
  return Math.max(1, (process.stdout.rows ?? 24) - CONTAINER_ROWS - used);
}

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

function shortPath(path: string): string {
  const home = homedir();
  return clean(path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path);
}

function rowMetadata(session: SessionInfo, width: number, showPath: boolean, showCwd: boolean): string {
  let meta = `${session.messageCount} msgs · ${age(session.modified)}`;
  let room = Math.floor(width * 0.65) - visibleWidth(meta) - 3;
  const cwdRoom = room - (showPath ? 26 : 0);
  if (showCwd && session.cwd && cwdRoom > 0) {
    const cwd = shortPath(session.cwd);
    const display = visibleWidth(cwd) <= cwdRoom ? cwd : basename(cwd);
    if (display && visibleWidth(display) <= cwdRoom) {
      meta = `${display} · ${meta}`;
      room -= visibleWidth(display) + 3;
    }
  }
  if (!showPath || room <= 4) return meta;
  const path = shortPath(session.path);
  const pathWidth = visibleWidth(path);
  const head = Math.floor(room / 2);
  const tail = room - head - 1;
  const display = pathWidth <= room ? path
    : `${truncateToWidth(path, head, "")}…${sliceByColumn(path, pathWidth - tail, tail)}`;
  return `${display} · ${meta}`;
}

// Leave room for the picker borders and spacers, the header block, the row counter and the
// footer; the footer itself takes whatever the terminal has left over.
function pageSize(): number {
  return Math.max(1, Math.min(10, (process.stdout.rows ?? 24) - 14));
}

export class BatchView implements Component {
  readonly #theme: Theme;
  readonly #selection: BatchSelection;
  readonly #picker: BatchPicker;
  readonly #search = new Input({ prompt: "Search> " });
  #filters: BatchFilters;
  #projection?: { listed: SessionInfo[]; filters: BatchFilters; query: string; asOf: number; validUntil: number };
  #showPath: boolean;
  #phase: Phase = { kind: "list" };
  #status?: { text: string; error: boolean };

  constructor(theme: Theme, selection: BatchSelection, picker: BatchPicker) {
    this.#theme = theme;
    this.#selection = selection;
    this.#picker = picker;
    this.#filters = { sortMode: picker.sortMode, nameFilter: picker.nameFilter, olderThanDays: 0, shortOnly: false };
    this.#showPath = picker.showPath;
    this.#search.setValue(picker.query);
    this.#search.handleInput("\x1b[F"); // Place the caret after the inherited query.
  }

  #updateRows(): void {
    const listed = this.#picker.listed();
    const query = this.#search.getValue();
    const filters = this.#filters;
    const now = Date.now();
    const previous = this.#projection;
    // Native incremental loads replace the array, even while the scope is still loading.
    if (previous?.listed === listed && previous.filters === filters && previous.query === query
        && now >= previous.asOf && now < previous.validUntil) return;
    const { rows, validUntil } = projectBatchRows(listed, filters, query, now);
    this.#selection.replaceRows(rows);
    this.#projection = { listed, filters, query, asOf: now, validUntil };
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
      lines.push(...hintLines(theme, CONFIRM_HINTS, width, footerRoom(lines.length)));
    } else {
      // Keep the cursor against the old list until Pi's incremental refresh finishes.
      if (phase.kind !== "deleting") this.#updateRows();
      const { scope } = this.#picker;
      const { sortMode, nameFilter, olderThanDays, shortOnly } = this.#filters;
      const query = this.#search.getValue();
      const hidden = state.hiddenCount;
      lines.push(theme.bold(`Batch Delete · ${state.selected.size} selected${hidden ? ` (${hidden} hidden)` : ""}`));
      lines.push("");
      const sort = sortMode === "threaded" ? "Threaded" : sortMode === "recent" ? "Recent" : "Fuzzy";
      const names = nameFilter === "all" ? "All Names" : nameFilter === "unnamed" ? "Unnamed" : "Named";
      const ageFilter = olderThanDays ? `>${olderThanDays}d` : "Any age";
      // Every control reads as its own item; the ones that are not at their default say so in accent.
      const chips: readonly (readonly [string, boolean])[] = [
        [scope === "current" ? "Current Folder" : "All Folders", scope !== "current"],
        [sort, sortMode !== "threaded"],
        [names, nameFilter !== "all"],
        [ageFilter, olderThanDays !== 0],
        [shortOnly ? "≤2 msgs" : "Any length", shortOnly],
        [`Paths ${this.#showPath ? "on" : "off"}`, this.#showPath],
      ];
      lines.push(chips.map(([text, active]) => theme.fg(active ? "accent" : "muted", text)).join(theme.fg("muted", " · ")));
      if (phase.kind === "search") {
        this.#search.focused = true;
        lines.push(...this.#search.render(width));
      } else if (query) lines.push(theme.fg("accent", `Search: ${clean(query)}`));
      if (this.#status) lines.push(theme.fg(this.#status.error ? "error" : "accent", this.#status.text));
      else if (phase.kind === "planning") lines.push(theme.fg("muted", "Planning deletion…"));
      else if (phase.kind === "deleting") lines.push(theme.fg("muted", "Deleting sessions and refreshing…"));
      if (this.#picker.loading) {
        const progress = this.#picker.loadProgress;
        lines.push(theme.fg("muted", `Loading sessions…${progress ? ` ${progress.loaded}/${progress.total}` : ""}`));
      } else if (this.#picker.loadError) lines.push(theme.fg("error", clean(this.#picker.loadError)));
      else if (!state.rows.length) lines.push(theme.fg("muted", "No matching sessions"));
      const range = state.range;
      const start = Math.max(0, Math.min(state.cursor - Math.floor(page / 2), state.rows.length - page));
      for (let i = start; i < Math.min(start + page, state.rows.length); i++) {
        const { session, depth, isLast, ancestorContinues } = state.rows[i]!;
        const live = state.isCurrent(session.path);
        const mark = live ? "[-]" : state.selected.has(canonicalize(session.path)) ? "[x]" : "[ ]";
        const tree = depth ? ancestorContinues.slice(1).map((continues) => continues ? "│  " : "   ").join("") + (isLast ? "└─ " : "├─ ") : "";
        // The range preview lives in a gutter that is always there, so no row ever shifts.
        const gutter = range && i >= range[0] && i <= range[1] ? "│" : " ";
        const left = `${i === state.cursor ? "› " : "  "}${gutter} ${mark} ${tree}${label(session)}`;
        const meta = rowMetadata(session, width, this.#showPath, scope === "all");
        const maxLeft = width - visibleWidth(meta) - 1;
        const text = truncateToWidth(left, maxLeft > 4 ? maxLeft : width, "…");
        const styled = theme.fg(i === state.cursor ? "accent" : live ? "dim" : session.name?.trim() ? "warning" : "text", text);
        lines.push(maxLeft > 4 ? styled + " ".repeat(width - visibleWidth(text) - visibleWidth(meta)) + theme.fg("dim", meta) : styled);
      }
      if (state.rows.length > page) lines.push(theme.fg("muted", `${state.cursor + 1} / ${state.rows.length}`));
      lines.push("");
      const room = footerRoom(lines.length);
      if (phase.kind === "search") lines.push(...hintLines(theme, SEARCH_HINTS, width, room));
      else if (range) lines.push(...hintLines(theme, RANGE_HINTS, width, room));
      else lines.push(...hintLines(theme, LIST_HINTS, width, room));
    }
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  handleInput(key: string): void {
    const phase = this.#phase;
    if (phase.kind !== "list" && phase.kind !== "search" && phase.kind !== "confirm") return;
    const escape = matchesKey(key, "escape");
    const enter = matchesKey(key, "enter");
    if (phase.kind === "search") {
      if (escape || enter) this.#phase = { kind: "list" };
      else {
        this.#search.handleInput(key);
        const value = this.#search.getValue();
        const safe = stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
        if (safe !== value) this.#search.setValue(safe);
      }
      return this.#picker.requestRender();
    }
    const page = pageSize();
    const delta = matchesKey(key, "up") ? -1 : matchesKey(key, "down") ? 1
      : matchesKey(key, "pageUp") ? -page : matchesKey(key, "pageDown") ? page : 0;
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
      const anchored = state.range !== undefined;
      this.#updateRows();
      // Don't apply a key meant for a preview that a refresh just canceled.
      if (anchored && !state.range) return this.#picker.requestRender();
      const letter = decodeKittyPrintable(key) ?? key;
      const space = matchesKey(key, "space");
      const movement = letter === "G" || (letter === "g" && matchesKey(key, "shift+g")) ? state.rows.length
        : letter === "g" ? -state.rows.length : delta;
      const filters = this.#filters;
      if (movement) state.move(movement);
      else if (anchored) {
        if (escape) state.cancelRange();
        else if (space || letter === "v") this.#status = state.markRange() === "active" ? activeSelectionError : undefined;
        else return;
      } else if (escape) return this.#picker.close();
      else if (letter === "v") {
        state.startRange();
        this.#status = undefined;
      } else if (letter === "/") this.#phase = { kind: "search" };
      else if (matchesKey(key, "tab")) return this.#picker.toggleScope();
      else if (letter === "n") this.#filters = {
        ...filters, nameFilter: filters.nameFilter === "all" ? "unnamed" : filters.nameFilter === "unnamed" ? "named" : "all",
      };
      else if (letter === "o") this.#filters = {
        ...filters, olderThanDays: filters.olderThanDays === 0 ? 7 : filters.olderThanDays === 7 ? 30 : 0,
      };
      else if (letter === "m") this.#filters = { ...filters, shortOnly: !filters.shortOnly };
      else if (letter === "s") this.#filters = {
        ...filters, sortMode: filters.sortMode === "threaded" ? "recent" : filters.sortMode === "recent" ? "relevance" : "threaded",
      };
      else if (letter === "p") this.#showPath = !this.#showPath;
      else if (space || letter === "t") {
        this.#status = state.toggle(letter === "t", this.#picker.listed()) === "active" ? activeSelectionError : undefined;
      } else if (letter === "a" || letter === "i") {
        this.#status = state.toggleVisible(letter === "i") === "active" ? activeSelectionError : undefined;
      } else if (letter === "c") {
        state.clear();
        this.#status = undefined;
      } else if (letter === "d" || enter) {
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
      this.#selection.refreshSelected(this.#picker.bothScopes());
      const plan = await planBatchDeletion(this.#selection.selected,
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
      for (const [path, id] of ids) if (gone.has(path)) this.#selection.unmark(id);
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
