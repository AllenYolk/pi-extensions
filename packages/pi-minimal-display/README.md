# Pi Minimal Display

Compact, expandable tool activity for Pi. Consecutive tool calls become a summary such as:

```text
bash ×3 read ×4 edit ×1
succeeded · ctrl+o to expand
```

A finished call that failed is named and counted in the summary, even while other calls are pending. Pending work keeps the pending card. Once every call has finished, a group with any failure uses a dark amber card on dark themes and a light amber card on light themes, for example `completed · 1 failed: codemode`. Later success does not erase that failure, and the count is calls, not tool names. Click a group or use Pi's configured tool-expansion shortcut to inspect its retained native details. Execution, tool definitions, model context, and saved conversation data are unchanged.

Summaries use the current Pi theme and native tool-card padding/backgrounds. Colored padding is clickable; the preceding blank line is not. Startup, new, resumed and forked sessions automatically begin minimal; `/reload` preserves Pi's current global expansion state. The existing tool shortcut (Ctrl+O by default) remains a two-state minimal/expanded toggle, including when rebound. This toggle is intentionally silent instead of inserting `Tool output: expanded/collapsed` into the transcript; the changed card detail is its feedback. Pi's native thinking-visibility shortcut (Ctrl+T by default) is likewise silent; the changed assistant presentation is its feedback. `/minimal-display` only reports status and is never required to activate the extension.

Status: `0.2.0` release candidate. Adds compact completed-failure cards with local failure counts and expandable model-request error folding. Tool-card compatibility remains tested on Pi 0.85.0, 0.85.1 and 0.99.1. This change was checked on Pi 0.99.1 and 1.1.0; the package's latest development host, and the host CI re-verifies, is 1.1.0. It accepts hosts whose patched presentation methods match a tested signature, so unrelated Pi releases do not require a plugin update; incompatible hosts stay native and display a diagnostic. A model-event seam that does not match falls back to native model errors without disabling tool cards. Compatibility results and limitations live in [validation](docs/validation.md).

## Install

The npm package is the recommended route; it versions and updates independently of the other extension in this repository:

```sh
pi install npm:@allenyolk/pi-minimal-display
```

Pin an immutable npm version when updates should not arrive automatically:

```sh
pi install npm:@allenyolk/pi-minimal-display@0.1.2
```

Or take it from the [pi-extensions collection](../../README.md#install), which also enables `@allenyolk/pi-delete` unless you narrow it with a resource filter:

```sh
pi install git:github.com/AllenYolk/pi-extensions
```

For one run without changing settings:

```sh
pi -e npm:@allenyolk/pi-minimal-display
```

Pick one route. Installing from both npm and the collection loads this extension twice.

## Try local source in an isolated profile

From the repository root, using your existing Pi installation:

```sh
PI_CODING_AGENT_DIR="$(mktemp -d)" pi -e ./packages/pi-minimal-display/src/index.ts
```

This profile is separate from your normal configuration and credentials. To test normal conversations you will need to configure that profile's provider separately. There is no installation hook or runtime dependency to install for this extension. Pi loads the TypeScript entry directly.

For a local package installation into a profile you have chosen:

```sh
pi install /absolute/path/to/pi-extensions/packages/pi-minimal-display
```

The repository, packed artifact and npm package all point to `src/index.ts`. No generated `dist/` is required for Pi loading; npm publication is not required for GitHub installation.

## Configuration

Create `extensions/pi-minimal-display/config.json` under Pi's actual agent directory (normally `~/.pi/agent`). `PI_CODING_AGENT_DIR` is respected. No file means these defaults:

```json
{
  "grouping": true,
  "default": "count_only",
  "modelErrors": "compact",
  "tools": {
    "read": "count_only",
    "grep": "count_only",
    "find": "count_only",
    "ls": "count_only",
    "bash": "lines",
    "edit": "lines",
    "write": "lines",
    "ask_user_question": "native",
    "plan_mode_question": "native",
    "plan_mode_complete": "native"
  },
  "bash": { "maxCommandChars": 120, "outputLines": 0 }
}
```

- `native`: preserve Pi's existing tool presentation. The three known interactive tools above use this by default; add other interactive tools by their actual registered names when needed.
- `count_only`: compact count/status, with retained native details on expansion.
- `lines`: joins the same group as count-only tools. When `grouping` is false, also shows a short command/path preview. Bash can show up to `outputLines` text lines.
- Tool overrides use exact names; defaults for other built-ins remain in effect. There is no MCP discovery or gateway-name guessing.
- Ordinary tools default to count-only, including `readSeek_edit`, `readSeek_grep` and future tool names. Counts identify actual registered names, not renderer titles. Explicit `default` and `tools` values remain authoritative; existing configurations explicitly setting `default: "native"` are not overwritten. To keep the pre-rc.3 unknown-tool behavior, set that value explicitly.
- `maxCommandChars` accepts integers 8–500, measured in Unicode code points; the preview also fits the terminal width. `outputLines` accepts integers 0–50. Neither changes actual arguments or results.
- Thinking visibility belongs only to Pi's native `hideThinkingBlock` setting in its regular settings file; this plugin never adds a second setting. Visible thinking remains native and splits adjacent tool groups. When Pi hides thinking, the compact presentation also omits Pi's `Thinking...` placeholder, and hidden-only blocks do not split adjacent managed tools. Visible assistant text still does.
- `modelErrors` is `compact` or `native`. `compact` is the default and does not follow `default` or `grouping`. `native` leaves model errors unchanged while tool cards still compact. An invalid value disables compact display for that runtime, as with any other invalid field.
- Older configs may still contain `hideThinking`; it is accepted only for migration and ignored. Remove it after moving the choice to Pi's native setting.

## Model request errors

Consecutive pure model errors are projected at render time into a single-line block, separate from tool groups. A pure error has `stopReason: "error"`, no response content, and its original error string:

```text
▸ model request · 2 errors · ctrl+o to expand
▸ model request · resumed · 2 errors · ctrl+o to expand
▸ model request · stopped · 3 errors · ctrl+o to expand
```

Model request blocks default to closed, keeping the transcript compact. When followed by a successful assistant reply, the block marks `resumed`. If execution stopped without recovery, `stopped` appears with the title highlighted in red; clicking the header or pressing Ctrl+O expands every original error in order. Historical and reloaded sessions are projected identically at render time without modifying saved session files. Cancelling or a partial response stays native. Error text is not summarized, rewritten, or deduplicated.

Changes take effect after `/reload` or restart. `/minimal-display` shows status and the configuration path. Unknown keys, invalid types, malformed JSON, or unreadable configuration disable compact display for that runtime and report the file path.

Groups end at intervening visible assistant text/thinking, native tools, other transcript output, user messages or skill invocations. Natively hidden thinking and empty tool-call-only assistant placeholders do not. Five calls, commentary, then three calls stay in that order as two groups, including when expanded. The session branch also identifies image-only user turns that have no visible user card. Expanded groups use Pi's native renderers, controls and images without adding a Retained data appendix. Native renderers may omit some successful text or metadata; raw arguments/results/details remain unchanged in Pi's session data. The plugin cannot recover output Pi already discarded.

## Runtime patches and recovery

This extension temporarily patches Pi's in-memory container rendering, mouse routing, Assistant presentation, and native expansion/status routing for tool and thinking toggles. Pi's native component state remains the sole thinking-visibility authority; the plugin only removes its hidden placeholder from the compact projection. It never edits installed Pi files and never registers replacement tools. All private host assumptions are kept in [presentation.ts](src/presentation.ts).

Installation checks required exports/descriptors and fingerprints of the host methods it patches, not the Pi version string. Shutdown and reload dispose owned patches; a runtime presentation failure disables the adapter and reports the fallback. Do not run it alongside `pi-tool-display`, `pi-tool-compact-display`, or `pi-compact-display`. Known tool-owner conflicts and prior modifications to the patched methods are rejected. Arbitrary third-party prototype patch combinations are not supported.

To recover, restart Pi without this extension. Remove the same source used for installation—for example `pi remove npm:@allenyolk/pi-minimal-display`, or the collection source if that is how it was installed—then restart. The configuration file can be kept. Running `pi --no-extensions` provides a diagnostic session with all auto-discovered extensions disabled.

## Development

Prerequisites: Node >=22.19.0, npm, and [uv](https://docs.astral.sh/uv/) for the standard-library Python PTY test harness on macOS/Linux.

From the repository root, which installs the workspace and this package's pinned Pi host:

```sh
npm ci --ignore-scripts
uv python install 3.12
npm --workspace @allenyolk/pi-minimal-display run check
npm --workspace @allenyolk/pi-minimal-display run benchmark
npm --workspace @allenyolk/pi-minimal-display exec -- npm pack --ignore-scripts
```

`npm run check` includes type checking, configuration/component regressions, real InteractiveMode replay/keyboard/mouse/image checks, a bundled Pi CLI probe with ten reloads, and an actual packed-artifact load. Tests use disposable directories under ignored `work/` and never alter the daily Pi profile.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for issue, review, and release gates. The authoritative contract is [pi-minimal-display#1](../../docs/archive/pi-minimal-display.md), archived from the retired repository.

## License and provenance

MIT, copyright AllenYolk. This is an original implementation, informed by the behavior of [pi-compact-display](https://github.com/Masterisk-F/pi-compact-display) and Pi's documented extension interfaces. No compact-display source was copied. Pi and its dependencies retain their respective licenses.
