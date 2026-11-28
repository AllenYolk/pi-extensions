# @allenyolk/pi-minimal-display

## 0.2.7

### Patch Changes

- 45e1100: Accept Pi 1.7.0's tested SDK and bundled-CLI `InteractiveMode.handleEvent` so model-request error folding activates on that host instead of falling back to native model errors. Pi 1.6.1 already activates on the allowlisted Pi 1.6.0 signatures.

## 0.2.6

### Patch Changes

- Accept Pi 1.6.0's presentation methods so compact tool cards and model-request folding activate on that host instead of failing closed to native display.

## 0.2.5

### Patch Changes

- 5748340: Accept Pi 1.5.1's tested SDK and bundled CLI presentation methods and retry event handler so compact tool cards and model-request errors no longer fall back to native display. Keep fail-closed compatibility checks and reversible patch ownership.

## 0.2.4

### Patch Changes

- e47d435: Accept Pi 1.5.0's tested SDK and bundled CLI presentation methods so compact tool cards and model-request errors no longer fall back to native display. Keep fail-closed compatibility checks and reversible patch ownership.

## 0.2.3

### Patch Changes

- Compact ask_user_question tool cards by default so questionnaire arguments and answers do not fill the collapsed transcript. Keep native details available on expansion and preserve explicit native overrides and the questionnaire's separate interactive view.

## 0.2.2

### Patch Changes

- Accept Pi 1.2.0's model-request event handler, so retry folding stays active instead of falling back to native model errors. Tool cards were already compatible; runtime behavior is unchanged.

## 0.2.1

### Patch Changes

- Show the last saved error on one line inside a closed stopped model-request block, and omit Pi's unsaved retry-failure notice.

## 0.2.0

### Minor Changes

- Show a completed tool group that contains failures as an amber summary with a local count, and fold a confirmed pure model-request retry into one expandable event. Execution, model context, and saved session data stay unchanged.

## 0.1.3

### Patch Changes

- 63f2e0d: Point the package metadata at the new source repository. Both packages now live in
  `AllenYolk/pi-extensions` under `packages/`, so `repository.url` and the new
  `repository.directory` field resolve to the actual source location. Runtime behaviour,
  commands, keybindings, configuration paths and certified Pi hosts are unchanged.
