/**
 * Slice 30b — Spike A, part 1 (deterministic, no model/browser).
 *
 * Proves the ONE correctness trap the mapping flagged for the leaf `streamText`
 * seam: `streamText(...)` returns its result object *promptly* and streams
 * lazily, so if `withWallClock`'s `fn` merely returns that object, the race
 * settles before generation happens and the wall-clock STOPS bounding the turn
 * (the model call leaks in the background). The fix: `fn` must DRAIN the stream
 * to completion (`await result.consumeStream()` / iterate `textStream`) so the
 * timeout still bounds the whole turn — and the abort signal must reach the
 * stream so it actually stops.
 *
 * We model `streamText`'s shape with a slow async-generator stand-in (no Ollama
 * needed), so this is a fast, deterministic, CI-able proof of trap + fix.
 *
 * Run: bun scripts/spikes/stream-wallclock-check.ts
 */
import { withWallClock } from '../../src/reliability/timeout.ts';

/** A stand-in for a streamText result: resolves promptly, streams slowly. */
function makeSlowStream(perTokenMs: number, tokens: string[], signal?: AbortSignal) {
  let consumed = false;
  async function* textStream() {
    for (const t of tokens) {
      await new Promise((r) => setTimeout(r, perTokenMs));
      if (signal?.aborted) throw new Error('aborted');
      yield t;
    }
  }
  return {
    get consumed() {
      return consumed;
    },
    textStream: textStream(),
    // mirrors v6 result.consumeStream(): drains without processing
    async consumeStream() {
      for await (const _ of textStream()) {
        if (signal?.aborted) throw new Error('aborted');
      }
      consumed = true;
    },
  };
}

async function main() {
  const TIMEOUT_MS = 300;
  const SLOW_TOKEN_MS = 100;
  const TOKENS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']; // ~1000ms total > 300ms cap

  let pass = true;

  // ── BAD pattern: fn returns the result object without draining ────────────
  // The race sees fn resolve immediately → NO timeout, generation unbounded.
  {
    const start = Date.now();
    let timedOut = false;
    try {
      // fn resolves as soon as the "result object" exists — like `() => streamText(...)`
      await withWallClock(TIMEOUT_MS, async (_signal) =>
        makeSlowStream(SLOW_TOKEN_MS, TOKENS),
      );
    } catch (e) {
      timedOut = (e as Error).message === 'timeout';
    }
    const elapsed = Date.now() - start;
    const defeated = !timedOut && elapsed < TIMEOUT_MS;
    console.log(
      `[BAD  ] returned-without-draining: timedOut=${timedOut} elapsed=${elapsed}ms ` +
        `→ wall-clock ${defeated ? 'DEFEATED (as predicted)' : 'unexpectedly held'}`,
    );
    if (!defeated) pass = false; // the trap must reproduce
  }

  // ── GOOD pattern: fn drains the stream, abort signal threaded ─────────────
  // Generation (~1000ms) exceeds the 300ms cap → timeout MUST fire.
  {
    const start = Date.now();
    let timedOut = false;
    try {
      await withWallClock(TIMEOUT_MS, async (signal) => {
        const result = makeSlowStream(SLOW_TOKEN_MS, TOKENS, signal);
        await result.consumeStream(); // drain to completion → bounds the turn
        return result;
      });
    } catch (e) {
      timedOut = (e as Error).message === 'timeout';
    }
    const elapsed = Date.now() - start;
    const heldWithinBudget = timedOut && elapsed < TIMEOUT_MS + 150;
    console.log(
      `[GOOD ] drained-with-consumeStream: timedOut=${timedOut} elapsed=${elapsed}ms ` +
        `→ wall-clock ${heldWithinBudget ? 'ENFORCED ✔' : 'FAILED to enforce'}`,
    );
    if (!heldWithinBudget) pass = false;
  }

  // ── GOOD pattern, fast stream: completes under budget, no false timeout ───
  {
    const start = Date.now();
    let ok = false;
    try {
      const out = await withWallClock(2000, async (signal) => {
        const result = makeSlowStream(10, ['x', 'y', 'z'], signal); // ~30ms << 2000ms
        await result.consumeStream();
        return result.consumed;
      });
      ok = out === true;
    } catch {
      ok = false;
    }
    console.log(
      `[GOOD ] fast-stream-under-budget: completed=${ok} elapsed=${Date.now() - start}ms ` +
        `→ ${ok ? 'no false timeout ✔' : 'unexpected failure'}`,
    );
    if (!ok) pass = false;
  }

  console.log(`\nSPIKE A part 1 (wall-clock × stream): ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  process.exit(pass ? 0 : 1);
}

main();
