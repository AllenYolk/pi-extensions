import { writeFileSync } from "node:fs";
import { Container } from "@earendil-works/pi-tui";
import { SessionSelectorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Reports which of the two extensions actually activated, by the host seam each one owns.
 * Pi's startup listing abbreviates entry paths once only one extension is present, so the
 * installed set is read from behaviour instead of from that text. The report is produced
 * from a command rather than a lifecycle handler, because handler order does not guarantee
 * that the other extensions have finished installing.
 */
export default function probe(pi: ExtensionAPI) {
  const pristineRender = Container.prototype.render;
  const pristineSelector = SessionSelectorComponent.prototype.handleInput;

  pi.registerCommand("loaded-probe", {
    description: "Isolated collection test harness; not part of any published package",
    handler: async (_args, ctx) => {
      const destination = process.env.PI_LOADED_PROBE_RESULT;
      if (!destination) throw new Error("PI_LOADED_PROBE_RESULT is required");
      writeFileSync(
        destination,
        JSON.stringify({
          display: Container.prototype.render !== pristineRender,
          delete: SessionSelectorComponent.prototype.handleInput !== pristineSelector,
          hasUI: ctx.hasUI,
        }),
      );
      ctx.shutdown();
    },
  });
}
