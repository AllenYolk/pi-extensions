import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Stands in for pi-subagents aborting a running child at shutdown: a write to a
 *  task transcript from a shutdown handler that runs after pi-delete's own. */
export default function (pi: ExtensionAPI): void {
  pi.on("session_shutdown", () => {
    const file = process.env.PI_LATE_WRITE;
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, "{}\n");
  });
}
