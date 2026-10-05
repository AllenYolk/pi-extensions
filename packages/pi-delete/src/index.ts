import { basename } from "node:path";
import * as Pi from "@earendil-works/pi-coding-agent";
import { collectDescendants, type DescendantEntry } from "./descendants.ts";
import { deleteSessionFiles } from "./delete-sessions.ts";
import { installSelectorCascade } from "./selector-patch.ts";

/** One line per session: indented by depth, identified the way Pi's own picker
 *  does it — by name or opening message, not by UUID filename. */
function describe({ session, depth }: DescendantEntry): string {
  const label = session.name
    ? `[named] ${session.name}`
    : (session.firstMessage || "(empty)").replace(/\s+/g, " ").slice(0, 60);
  return `${"  ".repeat(depth)}${label} · ${session.messageCount} msgs`;
}

export default function sessionDelete(pi: Pi.ExtensionAPI): void {
  let pending: string[] = [];
  let disposeCascade: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    disposeCascade?.();
    disposeCascade = undefined;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    disposeCascade = installSelectorCascade((message) =>
      ctx.ui.notify(`pi-delete: ${message}`, "warning"),
    );
  });

  pi.on("session_shutdown", async () => {
    disposeCascade?.();
    disposeCascade = undefined;
    const targets = pending;
    pending = [];
    const failures = await deleteSessionFiles(targets);
    if (failures.length > 0) {
      const lines = failures.map((f) => `  ${f.path}: ${f.error}`).join("\n");
      console.error(`pi-delete: ${failures.length} file(s) could not be deleted:\n${lines}`);
    }
  });

  pi.registerCommand("delete", {
    description: "Delete the current session and exit",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/delete needs an interactive session", "error");
        return;
      }
      const current = ctx.sessionManager.getSessionFile();
      if (!current) {
        ctx.ui.notify("Ephemeral session — nothing on disk to delete", "info");
        return;
      }

      const sessions = await Pi.SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
      const descendants = collectDescendants(sessions, current);

      const deleteCurrent = "Delete current session";
      const deleteTree = `Delete current + ${descendants.length} descendant${descendants.length === 1 ? "" : "s"}`;
      const cancel = "Cancel";
      // The listing rides on the prompt rather than a second confirmation: what
      // the count alone hides is *which* sessions go, and that has to be visible
      // before the choice, not after it.
      const prompt =
        descendants.length > 0
          ? `Delete session and exit?\n\nCascade also removes:\n${descendants.map(describe).join("\n")}`
          : "Delete session and exit?";
      const choice = await ctx.ui.select(
        prompt,
        descendants.length > 0 ? [deleteCurrent, deleteTree, cancel] : [deleteCurrent, cancel],
      );
      if (choice === undefined || choice === cancel) return;

      pending =
        choice === deleteTree
          ? [current, ...descendants.map((d) => d.session.path)]
          : [current];
      ctx.shutdown();
    },
  });
}
