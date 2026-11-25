import { rawKeyHint, SessionManager, SessionSelectorComponent, type SessionInfo, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { BatchSelection, type BatchRow } from "./batch-selection.ts";
import { BatchView } from "./batch-view.ts";
import { canonicalize, planCascade, withTaskSessions } from "./descendants.ts";
import { deleteSessionFiles } from "./delete-sessions.ts";

/** Pressed while Pi's own ctrl+d confirmation is up, so the cascade is a second
 *  answer to a question the picker already asked. A plain letter is safe there:
 *  the picker ignores every other key in that state, and unlike shift+enter or
 *  shift+ctrl+d it needs no kitty keyboard protocol to be distinguishable. */
const CASCADE_KEY = "t";
const INSTALLED = Symbol.for("pi-delete.selectorCascade");
const HEADER_PATCHED = Symbol.for("pi-delete.selectorHint");
/** Text Pi puts in its confirmation line, and the separator between its hints. */
const CONFIRM_MARKER = "Delete session?";
const SEPARATOR = " \u00b7 ";

interface Selector {
  scope: "current" | "all";
  currentSessions: SessionInfo[] | null;
  allSessions: SessionInfo[] | null;
  header: { setStatusMessage(msg: { type: string; message: string } | null, ms?: number): void };
  requestRender(): void;
  refreshSessionsAfterMutation?(): Promise<void>;
  sessionList: {
    confirmingDeletePath: string | null;
    setConfirmingDeletePath(path: string | null): void;
    isCurrentSessionPath(path: string): boolean;
    setSessions(sessions: SessionInfo[], showCwd: boolean): void;
  };
}

interface BatchSelector extends Selector {
  sortMode: "threaded" | "recent" | "relevance";
  nameFilter: "all" | "named";
  buildBaseLayout(content: Component, opts?: { showHeader: boolean }): void;
  toggleScope(): void;
  header: Selector["header"] & {
    setScope(scope: Selector["scope"]): void;
    loading: boolean;
    loadProgress: { loaded: number; total: number } | null;
    statusMessage: { type: string; message: string } | null;
  };
  sessionList: Selector["sessionList"] & Component & {
    filteredSessions: BatchRow[];
    selectedIndex: number;
    searchInput: { getValue(): unknown };
    showPath?: unknown;
  };
}

/** These are internals of an exported class, so they are checked before the
 *  patch acts on a keystroke; anything unexpected falls back to Pi's behavior. */
function usable(target: unknown): target is Selector {
  const s = target as Record<string, unknown> | null;
  if (!s || typeof s.requestRender !== "function") return false;
  const list = s.sessionList as Record<string, unknown> | undefined;
  const header = s.header as Record<string, unknown> | undefined;
  return (
    !!list &&
    !!header &&
    typeof header.setStatusMessage === "function" &&
    typeof list.setConfirmingDeletePath === "function" &&
    typeof list.isCurrentSessionPath === "function" &&
    typeof list.setSessions === "function" &&
    (s.refreshSessionsAfterMutation === undefined || typeof s.refreshSessionsAfterMutation === "function") &&
    (s.scope === "current" || s.scope === "all")
  );
}

function usableForBatch(s: Record<string, unknown>): s is Record<string, unknown> & BatchSelector {
  if (!usable(s)) return false;
  const list = s.sessionList as unknown as Record<string, unknown>;
  const header = s.header as unknown as Record<string, unknown>;
  const search = list.searchInput as { getValue?: unknown } | undefined;
  const session = (row: unknown) => {
    const info = row as Partial<SessionInfo> | null;
    return info && typeof info.path === "string" && typeof info.firstMessage === "string"
      && typeof info.id === "string" && typeof info.allMessagesText === "string" && typeof info.cwd === "string"
      && (info.name === undefined || typeof info.name === "string")
      && (info.parentSessionPath === undefined || typeof info.parentSessionPath === "string")
      && Number.isInteger(info.messageCount) && info.modified instanceof Date;
  };
  const sessions = (value: unknown) => value === null || (Array.isArray(value) && value.every(session));
  const progress = header.loadProgress as BatchSelector["header"]["loadProgress"] | undefined;
  const status = header.statusMessage as BatchSelector["header"]["statusMessage"] | undefined;
  return s.mode === "list"
    && typeof s.buildBaseLayout === "function" && typeof s.toggleScope === "function"
    && (s.sortMode === "threaded" || s.sortMode === "recent" || s.sortMode === "relevance")
    && (s.nameFilter === "all" || s.nameFilter === "named")
    && sessions(s.currentSessions) && sessions(s.allSessions)
    && typeof header.setScope === "function" && typeof header.render === "function"
    && typeof header.loading === "boolean"
    && (progress === null || (!!progress && Number.isFinite(progress.loaded) && Number.isFinite(progress.total)))
    && (status === null || (!!status && typeof status.type === "string" && typeof status.message === "string"))
    && typeof list.render === "function" && typeof list.invalidate === "function"
    && list.confirmingDeletePath === null
    && Number.isInteger(list.selectedIndex) && typeof search?.getValue === "function"
    && Array.isArray(list.filteredSessions) && list.filteredSessions.every((row) =>
      row && session(row.session) && Number.isInteger(row.depth) && row.depth >= 0
      && typeof row.isLast === "boolean" && Array.isArray(row.ancestorContinues)
      && row.ancestorContinues.every((entry: unknown) => typeof entry === "boolean"));
}

const EMPTY_SESSIONS: SessionInfo[] = [];
function listedSessions(selector: Selector): SessionInfo[] {
  return (selector.scope === "all" ? selector.allSessions : selector.currentSessions) ?? EMPTY_SESSIONS;
}

function removePickerSessions(selector: Selector, gone: ReadonlySet<string>): void {
  const keep = (list: SessionInfo[] | null) => list?.filter((s) => !gone.has(s.path)) ?? null;
  selector.currentSessions = keep(selector.currentSessions);
  selector.allSessions = keep(selector.allSessions);
  selector.sessionList.setSessions(listedSessions(selector), selector.scope === "all");
}

/**
 * Add the cascade hint to Pi's delete-confirmation line, between the confirm
 * and cancel hints so the three read in the order they escalate. Built with
 * Pi's own rawKeyHint so it inherits the dim-key/muted-label styling of its
 * neighbours, and spliced before the first separator so it lands inside the
 * line's existing color runs rather than after them.
 *
 * Patched on the header instance's prototype, reached through a live selector
 * because the header class is not exported. Does nothing if the line is
 * missing, the separator is gone, or the row has no space left.
 */
function patchHeaderHint(header: object): (() => void) | undefined {
  const proto = Object.getPrototypeOf(header) as Record<string | symbol, unknown> | null;
  const original = proto && Object.getOwnPropertyDescriptor(proto, "render")?.value;
  if (!proto || typeof original !== "function" || proto[HEADER_PATCHED]) return undefined;

  proto[HEADER_PATCHED] = true;
  const render = function (this: { confirmingDeletePath?: string | null; statusMessage?: unknown }, width: number) {
    const lines: unknown = original.call(this, width);
    if (!Array.isArray(lines)) return lines;
    if (!this.confirmingDeletePath) {
      const line = lines[1];
      if (this.statusMessage || typeof line !== "string" || !line.includes("scope") || !line.includes("re:<pattern>")) return lines;
      const extra = SEPARATOR + rawKeyHint("ctrl+x", "select");
      if (visibleWidth(line) + visibleWidth(extra) > width) return lines;
      const hinted = [...lines];
      hinted[1] = line + extra;
      return hinted;
    }
    const hint = rawKeyHint(CASCADE_KEY, "subtree");
    const extra = visibleWidth(hint) + visibleWidth(SEPARATOR);
    return lines.map((line) => {
      if (typeof line !== "string" || !line.includes(CONFIRM_MARKER)) return line;
      const at = line.indexOf(SEPARATOR);
      if (at < 0 || visibleWidth(line) + extra > width) return line;
      return line.slice(0, at) + SEPARATOR + hint + line.slice(at);
    });
  };
  proto.render = render;
  return () => {
    if (proto.render === render) proto.render = original;
    delete proto[HEADER_PATCHED];
  };
}

async function runCascade(selector: Selector, targets: string[]): Promise<void> {
  const failures = deleteSessionFiles(targets);
  const failed = new Set(failures.map((f) => f.path));
  const gone = new Set(targets.filter((p) => !failed.has(p)));

  // Subagent sessions are not rows in the picker, so the count says how many of
  // the deleted ones the user never saw; otherwise it disagrees with the subtree.
  const rows = new Set([...(selector.currentSessions ?? []), ...(selector.allSessions ?? [])].map((s) => s.path));
  const hidden = [...gone].filter((p) => !rows.has(p)).length;
  const hiddenNote = hidden ? ` (${hidden} hidden)` : "";

  removePickerSessions(selector, gone);

  selector.header.setStatusMessage(
    failures.length
      ? { type: "error", message: `Deleted ${gone.size}${hiddenNote}, failed ${failures.length}: ${failures[0]?.error.slice(0, 60)}` }
      : { type: "info", message: `Deleted ${gone.size} session${gone.size === 1 ? "" : "s"}${hiddenNote}` },
    4000,
  );

  await selector.refreshSessionsAfterMutation?.();
  selector.requestRender();
}

export function installSelectorPatch(theme: Theme, report: (message: string) => void): (() => void) | undefined {
  const proto = SessionSelectorComponent?.prototype as unknown as
    | Record<string | symbol, unknown>
    | undefined;
  if (typeof proto?.handleInput !== "function") {
    report("session picker does not expose handleInput; picker extensions disabled");
    return undefined;
  }
  if (proto[INSTALLED]) return undefined;

  const original = proto.handleInput as (this: unknown, data: unknown) => unknown;
  let reportedMismatch = false;
  let disposeHint: (() => void) | undefined;
  const batches = new WeakMap<object, BatchView>();
  const closeBatches = new Set<() => void>();
  const originalLayout = proto.buildBaseLayout;

  // The private header class is only reachable after Pi creates a picker.
  const buildBaseLayout = function (this: { header?: object }, ...args: unknown[]) {
    if (!disposeHint && this.header) disposeHint = patchHeaderHint(this.header);
    return (originalLayout as (...args: unknown[]) => unknown).apply(this, args);
  };
  if (typeof originalLayout === "function") proto.buildBaseLayout = buildBaseLayout;

  proto[INSTALLED] = true;
  const warnMismatch = (feature: string) => {
    if (reportedMismatch) return;
    reportedMismatch = true;
    report(`session picker internals changed; ${feature} disabled`);
  };
  const handleInput = function (this: Record<string, unknown>, data: unknown) {
    const forward = () => original.call(this, data);
    // A host without the layout hook can still advertise the native cascade.
    if (!disposeHint && this.header) disposeHint = patchHeaderHint(this.header as object);
    const batch = batches.get(this);
    if (batch && typeof data === "string") return batch.handleInput(data);
    if (this.mode === "rename" || typeof data !== "string") return forward();

    const list = this.sessionList as { confirmingDeletePath?: string | null } | undefined;
    const target = list?.confirmingDeletePath;
    if (!target && matchesKey(data, "ctrl+x")) {
      if (!usableForBatch(this)) {
        warnMismatch("Batch mode");
        return forward();
      }
      const selector = this;
      const { sessionList } = selector;
      let query: unknown;
      try {
        query = sessionList.searchInput.getValue();
      } catch {
        // A changed input implementation must not take down the native picker.
      }
      if (typeof query !== "string") {
        warnMismatch("Batch mode");
        return forward();
      }
      const selection = new BatchSelection(sessionList.filteredSessions, sessionList.selectedIndex,
        (path) => sessionList.isCurrentSessionPath(path));
      const close = () => {
        view.dispose();
        batches.delete(selector);
        closeBatches.delete(close);
        const cursorPath = selection.cursorRow?.session.path;
        selector.header.setScope(selector.scope);
        sessionList.setSessions(listedSessions(selector), selector.scope === "all");
        if (cursorPath !== undefined) {
          const id = canonicalize(cursorPath);
          const index = sessionList.filteredSessions.findIndex(({ session }) => canonicalize(session.path) === id);
          if (index >= 0) sessionList.selectedIndex = index;
        }
        selector.buildBaseLayout(sessionList);
        selector.requestRender();
      };
      const view = new BatchView(theme, selection, {
        get scope() { return selector.scope; },
        get loading() { return selector.header.loading; },
        get loadProgress() { return selector.header.loadProgress; },
        get loadError() {
          const { statusMessage } = selector.header;
          return statusMessage?.type === "error" ? statusMessage.message : undefined;
        },
        toggleScope: () => selector.toggleScope(),
        sortMode: selector.sortMode,
        nameFilter: selector.nameFilter,
        query,
        showPath: sessionList.showPath === true,
        listed: () => listedSessions(selector),
        *bothScopes() {
          yield* (selector.scope === "current" ? selector.allSessions : selector.currentSessions) ?? [];
          yield* listedSessions(selector);
        },
        requestRender: () => selector.requestRender(),
        async refreshAfterDelete(gone) {
          removePickerSessions(selector, gone);
          await selector.refreshSessionsAfterMutation?.();
        },
        close,
      });
      try {
        selector.buildBaseLayout(view, { showHeader: false });
      } catch {
        selector.buildBaseLayout(sessionList);
        warnMismatch("Batch mode");
        return forward();
      }
      batches.set(selector, view);
      closeBatches.add(close);
      selector.requestRender();
      return undefined;
    }
    // Only meaningful as an answer to Pi's own delete confirmation.
    if (!target || data !== CASCADE_KEY) return forward();

    if (!usable(this)) {
      warnMismatch("cascade delete");
      return forward();
    }

    const selector = this;
    const isCurrent = (p: string) => selector.sessionList.isCurrentSessionPath(p);
    const listed = listedSessions(selector);

    selector.sessionList.setConfirmingDeletePath(null);
    if (isCurrent(target)) {
      selector.header.setStatusMessage(
        { type: "error", message: "Cannot delete the currently active session" },
        3000,
      );
      selector.requestRender();
      return undefined;
    }

    void withTaskSessions(listed, target, (dir) => SessionManager.listAll(dir), isCurrent)
      .then((pool) => runCascade(selector, planCascade(pool, target, isCurrent)))
      .catch((error: unknown) => {
        selector.header.setStatusMessage({ type: "error", message: `Cascade failed: ${String(error).slice(0, 60)}` }, 4000);
        selector.requestRender();
      });
    return undefined;
  };

  proto.handleInput = handleInput;
  return () => {
    for (const close of closeBatches) close();
    disposeHint?.();
    disposeHint = undefined;
    if (proto.handleInput === handleInput) proto.handleInput = original;
    if (proto.buildBaseLayout === buildBaseLayout) proto.buildBaseLayout = originalLayout;
    delete proto[INSTALLED];
  };
}
