## Task 12: Live test

**Files:** Create `tests/integration/verification.live.test.ts`

- [ ] Mirror `tests/integration/memory.live.test.ts` skip guard (Ollama up). Pull-or-skip `bespoke-minicheck`. Assert: a grounded answer (claim + matching cited chunk) → `supported:true`; a planted hallucination (claim contradicting its cited chunk) → `supported:false` with the claim listed. 180s timeout. Skips cleanly without Ollama/MiniCheck. Commit `test(verification): live MiniCheck faithfulness roundtrip (skips w/o model)`.

---

