---
"@allenyolk/pi-compaction": patch
---

Export the package's thinking levels as one list, `THINKING_LEVELS` in `src/config.ts`.

The same seven levels were written out three times: in `src/config.ts`, in `src/summarizer.ts` and
again in the evaluation harness. Two modules that each validate or clamp against their own copy
drift apart silently — a level added to one is not a level the other accepts. `src/summarizer.ts`
now clamps through the exported list and the harness imports it, so the configuration, the clamp and
the harness's refusal of an unknown arm level are the same set by construction.

No behavior changes: the list, its order and every rejection message are what they were. The export
is additive.
