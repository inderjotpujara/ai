
Nothing new to save. This session executed existing scope (Task 8 crews docs + whole-branch review) and applied existing governance (docs hard-line: when CREW_TASK_MEMBER was claimed in docs but unfired, emit it rather than weaken). All durable facts (crews design scope, docs governance, throw-behavior nuances, live-selection verification) were already captured in memory.
Yes, one durable constraint surfaced:

**Documentation hard-line expanded.** Previously it enforced `architecture.md` updates only; now it requires **all four living surfaces** (architecture.md + README.md + ROADMAP.md + the Artifact) to stay in sync when a slice lands, **enforced by a pre-push gate that blocks slice-landing pushes missing README+ROADMAP updates**.

This should update the existing memory `[[docs-governance-enforcement]]` (shown in your MEMORY.md).

One loose thread: the conversation ended mid-check on whether `.remember/` and `.superpowers/` need updating or hard-line treatment. Should I also note that as a pending question, or will you resolve it separately?