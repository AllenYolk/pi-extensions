import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Container } from "@earendil-works/pi-tui";
import {
  ToolExecutionComponent,
  UserMessageComponent,
  SessionSelectorComponent,
  createBashToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

/**
 * Coexistence harness. Loaded after both extensions, so the module scope still sees the
 * pristine host methods and every round can prove that each extension restored its own
 * wrapper before the next install.
 */
export default function probe(pi: ExtensionAPI) {
  const pristineRender = Container.prototype.render;
  const pristineSelector = SessionSelectorComponent.prototype.handleInput;
  const key = Symbol.for("pi-extensions/coexistence-probe");
  const store = globalThis as typeof globalThis & {
    [key]?: { round: number; pristineRender: typeof pristineRender; pristineSelector: typeof pristineSelector };
  };
  const run = (store[key] ??= { round: 0, pristineRender, pristineSelector });
  // A reload re-imports this module, so only the first capture is pristine.
  const restored = pristineRender === run.pristineRender && pristineSelector === run.pristineSelector;
  let report: Record<string, unknown> | undefined;

  pi.on("session_shutdown", () => {
    if (!report) return;
    try {
      assert.equal(Container.prototype.render, run.pristineRender, "presentation patch survived shutdown");
      assert.equal(SessionSelectorComponent.prototype.handleInput, run.pristineSelector, "picker patch survived shutdown");
      report.shutdownRestored = true;
    } catch (error) {
      report.passed = false;
      report.error = String(error);
    }
    writeFileSync(process.env.PI_COEXISTENCE_RESULT!, JSON.stringify(report));
  });

  pi.registerCommand("coexistence-probe", {
    description: "Isolated collection test harness; not part of any published package",
    handler: async (_args, ctx) => {
      const destination = process.env.PI_COEXISTENCE_RESULT;
      if (!destination) throw new Error("PI_COEXISTENCE_RESULT is required");
      try {
        assert.ok(ctx.hasUI);
        assert.ok(restored, "a previous runtime patch was not restored before reload");

        // Both extensions own a different seam; neither may be missing or shadowed.
        assert.notEqual(
          Container.prototype.render,
          pristineRender,
          "pi-minimal-display did not install its presentation patch",
        );
        assert.notEqual(
          SessionSelectorComponent.prototype.handleInput,
          pristineSelector,
          "pi-delete did not install its session-picker patch",
        );

        // Grouping and expansion, through real tool components in a real transcript.
        const definition = createBashToolDefinition(ctx.cwd);
        const transcript = new Container();
        transcript.addChild(new UserMessageComponent("synthetic coexistence input"));
        const result = await definition.execute(
          "fixture",
          { command: 'printf "coexistence-output"' },
          undefined,
          undefined,
          ctx,
        );
        const calls = ["first", "second", "third"].map((id) => {
          const call = new ToolExecutionComponent(
            "bash",
            id,
            { command: 'printf "coexistence-output"' },
            {},
            definition,
            { requestRender() {} } as never,
            ctx.cwd,
          );
          call.updateResult({ ...result, isError: false });
          transcript.addChild(call);
          return call;
        });
        const collapsed = transcript.render(80).join("\n");
        assert.match(collapsed, /bash ×3/);
        assert.doesNotMatch(collapsed, /coexistence-output/);
        for (const call of calls) call.setExpanded(true);
        assert.match(transcript.render(80).join("\n"), /coexistence-output/);

        const reloads = Number(process.env.PI_COEXISTENCE_RELOADS ?? 0);
        if (run.round < reloads) {
          run.round++;
          await ctx.reload();
          process.stdout.write("\nPI_COEXISTENCE_READY\n");
          return;
        }
        report = { passed: true, reloads: run.round, groupedCalls: calls.length, collapsed };
      } catch (error) {
        writeFileSync(destination, JSON.stringify({ passed: false, error: String(error) }));
      }
      ctx.shutdown();
    },
  });
}
