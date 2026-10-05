import { rawKeyHint, SessionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { planCascade } from "./descendants.ts";
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

interface SessionRow {
  path: string;
  name?: string;
  firstMessage?: string;
}

interface Selector {
  scope: "current" | "all";
  currentSessions: SessionRow[] | null;
  allSessions: SessionRow[] | null;
  header: { setStatusMessage(msg: { type: string; message: string } | null, ms?: number): void };
  requestRender(): void;
  refreshSessionsAfterMutation?(): Promise<void>;
  sessionList: {
    confirmingDeletePath: string | null;
    setConfirmingDeletePath(path: string | null): void;
    isCurrentSessionPath(path: string): boolean;
    setSessions(sessions: unknown[], showCwd: boolean): void;
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
    (s.scope === "current" || s.scope === "all")
  );
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
  const original = proto?.render;
  if (!proto || typeof original !== "function" || proto[HEADER_PATCHED]) return undefined;

  proto[HEADER_PATCHED] = true;
  proto.render = function (this: { confirmingDeletePath?: string | null }, width: number) {
    const lines = (original as (w: number) => unknown).call(this, width);
    if (!this.confirmingDeletePath || !Array.isArray(lines)) return lines;
    const hint = rawKeyHint(CASCADE_KEY, "subtree");
    const extra = visibleWidth(hint) + visibleWidth(SEPARATOR);
    return lines.map((line) => {
      if (typeof line !== "string" || !line.includes(CONFIRM_MARKER)) return line;
      const at = line.indexOf(SEPARATOR);
      if (at < 0 || visibleWidth(line) + extra > width) return line;
      return line.slice(0, at) + SEPARATOR + hint + line.slice(at);
    });
  };
  return () => {
    proto.render = original;
    delete proto[HEADER_PATCHED];
  };
}

async function runCascade(selector: Selector, targets: string[]): Promise<void> {
  const failures = await deleteSessionFiles(targets);
  const failed = new Set(failures.map((f) => f.path));
  const gone = new Set(targets.filter((p) => !failed.has(p)));

  const keep = <T extends { path: string }>(list: T[] | null) =>
    list ? list.filter((s) => !gone.has(s.path)) : list;
  selector.currentSessions = keep(selector.currentSessions);
  selector.allSessions = keep(selector.allSessions);

  const showCwd = selector.scope === "all";
  selector.sessionList.setSessions((showCwd ? selector.allSessions : selector.currentSessions) ?? [], showCwd);

  selector.header.setStatusMessage(
    failures.length
      ? { type: "error", message: `Deleted ${gone.size}, failed ${failures.length}: ${failures[0]?.error.slice(0, 60)}` }
      : { type: "info", message: `Deleted ${gone.size} session${gone.size === 1 ? "" : "s"}` },
    4000,
  );

  await selector.refreshSessionsAfterMutation?.();
  selector.requestRender();
}

/**
 * Extend Pi's delete confirmation in the session picker: ctrl+d then `t`
 * removes the highlighted session together with its descendants, where ctrl+d
 * then enter removes just the one. Returns a disposer, or undefined when the
 * host does not look the way this patch expects.
 */
export function installSelectorCascade(report: (message: string) => void): (() => void) | undefined {
  const proto = SessionSelectorComponent?.prototype as unknown as
    | Record<string | symbol, unknown>
    | undefined;
  if (typeof proto?.handleInput !== "function") {
    report("session picker does not expose handleInput; cascade delete disabled");
    return undefined;
  }
  if (proto[INSTALLED]) return undefined;

  const original = proto.handleInput as (this: unknown, data: unknown) => unknown;
  let reportedMismatch = false;
  let disposeHint: (() => void) | undefined;

  proto[INSTALLED] = true;
  proto.handleInput = function (this: Record<string, unknown>, data: unknown) {
    const forward = () => original.call(this, data);
    // The hint needs a live header, which only exists once a picker is open.
    if (!disposeHint && this.header) disposeHint = patchHeaderHint(this.header as object);
    if (this.mode === "rename" || data !== CASCADE_KEY) return forward();

    const list = this.sessionList as { confirmingDeletePath?: string | null } | undefined;
    const target = list?.confirmingDeletePath;
    // Only meaningful as an answer to Pi's own delete confirmation.
    if (!target) return forward();

    if (!usable(this)) {
      if (!reportedMismatch) {
        reportedMismatch = true;
        report("session picker internals changed; cascade delete disabled");
      }
      return forward();
    }

    const selector = this as unknown as Selector;
    const pool = (selector.scope === "all" ? selector.allSessions : selector.currentSessions) ?? [];
    const plan = planCascade(pool as never, target, (p) => selector.sessionList.isCurrentSessionPath(p));

    selector.sessionList.setConfirmingDeletePath(null);
    if (plan.blocked) {
      selector.header.setStatusMessage(
        { type: "error", message: "Cannot delete the currently active session" },
        3000,
      );
      selector.requestRender();
      return undefined;
    }

    void runCascade(selector, plan.targets);
    return undefined;
  };

  return () => {
    disposeHint?.();
    disposeHint = undefined;
    proto.handleInput = original;
    delete proto[INSTALLED];
  };
}
