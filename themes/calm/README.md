# calm

An understated Pi theme with optional configuration for `@narumitw/pi-starship`.
All seven thinking levels use the same soft-violet editor border, so `max` does not
look like an error. Pi still owns the compact editor, its embedded Working indicator,
input, shortcuts, history, completion, paste and selection. Bash, error, warning,
message and tool colors are unchanged.

The footer removes model/thinking/directory pictograms, gives model and thinking the
same color, abbreviates parent directories without shortening the final name, and
uses muted dots between fields and retains Git status symbols and context/cache/token/cost
information. The branch has no pictogram; status counts stay beside its name. Optional
fields carry their separator only when visible. Cache hit rate is enabled;
context and cost keep their visibility thresholds and warning colors.

## Use

These are ordinary configuration files, not an npm package or executable extension.
The collection manifest does not declare them. Installing the collection is not the
activation path, and installing the theme never applies the Starship TOML.

From the repository root, copy `themes/calm/calm.json` to
`<agent-dir>/themes/calm.json`, then select **calm** in Pi's `/settings`.
The agent directory normally is `~/.pi/agent`; `PI_CODING_AGENT_DIR` can change it.
Inspect and back up an existing `calm.json` before replacing it.

The footer requires the existing `@narumitw/pi-starship` extension. Review
`themes/calm/pi-starship.toml`, then merge its settings into `<agent-dir>/pi-starship.toml`.
Preserve unrelated configuration and back up the original first. The complete sample
may replace that file only when replacing all its settings is intended.
This is not shell Starship's `~/.config/starship.toml`.

Use `/starship settings` for an interactive edit and preview, or the extension's
bundled `configuring-pi-starship` skill for a validated, backed-up external edit.
Reload after the running task has finished and inspect `/starship status` for diagnostics.
Do not interrupt an ongoing task just to apply these preferences.

There is no background synchronization or automatic application. The repository files
are the maintained preset; personal files are explicitly deployed copies. Keep the
personal theme directly in `themes/calm.json` for Pi's native user-theme hot reload.

## Compatibility and checks

The theme is a complete snapshot of
[Pi 1.0.2 dark](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/modes/interactive/theme/dark.json),
not an overlay. Future Pi releases that add required theme fields need a deliberate update.
The footer configuration targets `@narumitw/pi-starship` 0.58.0 and its
[configuration contract](https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-starship/skills/configuring-pi-starship/references/configuration.md).

Use the real Pi theme loader and Starship configuration loader to check these assets.
Verify all thinking levels, native Working, Bash/error colors, reload, width changes,
cache availability and context/cost thresholds. Check Git and non-Git paths,
hidden and Chinese parents, and a long final directory name. Narrow footers wrap through
the existing plugin rather than truncating that name.

Native editing is unchanged, but a PTY or component probe does not prove terminal
clipboard behavior. Verify Chinese text, explicit newlines and automatic wrapping in
the terminal actually used; report this separately from loader/render checks.

## Rollback

Restore the previous theme selection (for example `dark`) and saved Starship TOML,
then reload after the current task finishes. No plugin uninstall is required.

## Ownership and future UI

Keep calm-specific assets, documentation and licensing in this directory. `calm.json`
owns Pi theme colors; the TOML is optional configuration for the existing footer owner.
There is no custom editor, runtime entrypoint, generator or installation hook.

If actual UI behavior is added, move this whole unit into an independent workspace
such as `packages/pi-calm` using Git, preserving the theme name and personal config paths.
Only then add its manifest, source entry, behavior checks and independent release process.
Own that behavior in the new package, use Pi's public interfaces/native components,
and read the active theme's semantic colors rather than copying another palette into code.
Keep Starship integration optional and never overwrite personal configuration on load.

## License

MIT. The theme derives from Pi 1.0.2, copyright 2025 Mario Zechner.
Preset modifications and this documentation are copyright 2026 AllenYolk.
The complete upstream notice and grant are retained in [LICENSE](LICENSE).
