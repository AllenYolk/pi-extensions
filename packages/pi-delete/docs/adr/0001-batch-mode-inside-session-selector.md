# Keep Batch mode inside the session selector

Batch mode swaps the body of `SessionSelectorComponent` with `buildBaseLayout`, the same seam Pi uses for rename. A new slash command or CLI would separate cleanup from the search, scope, and cursor that led to it. Patching `SessionList.render` would make Pi's list responsible for a second input and confirmation flow. The Batch view instead reads Pi's rows, owns its marks, and restores the native body on exit.

The selector adapter checks the private layout and state it needs before taking over input. On mismatch it warns once and leaves the key with Pi; on shutdown it restores the live layout and prototype methods. The startup `pi --resume` picker runs before extensions load, so only the picker opened within Pi can use this seam.
