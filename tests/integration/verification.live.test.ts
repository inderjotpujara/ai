import { describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import qwenRouter from '../../models/qwen-router.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { makeEmbedder, probeEmbedder } from '../../src/memory/embed.ts';
import { createMemoryStore } from '../../src/memory/store.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { isModelInstalled } from '../../src/resource/ollama-control.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';
import { makeVerifyDeps } from '../../src/verification/deps.ts';
import { verify } from '../../src/verification/verify.ts';
import { ollamaReady } from './ollama-available.ts';

const EMBED_MODEL = 'qwen3-embedding:0.6b';
const JUDGE_MODEL = 'bespoke-minicheck';
const SPACE = 'default';
const DIR = '/tmp/verify-live';

/** True iff Ollama is up AND the judge model is installed (pulling it if
 *  missing succeeds silently). Pull-or-skip: if the pull fails for any
 *  reason (offline, disk, etc.) this resolves false so the suite skips
 *  cleanly instead of hanging or hard-failing. */
async function judgeReady(): Promise<boolean> {
  const embedOk = await ollamaReady(EMBED_MODEL);
  if (!embedOk) return false;
  try {
    if (await isModelInstalled(JUDGE_MODEL)) return true;
    const control = runtimeFor(RuntimeKind.Ollama).control;
    await control.pull(JUDGE_MODEL);
    return await isModelInstalled(JUDGE_MODEL);
  } catch {
    return false;
  }
}

const ready = await judgeReady();

describe.skipIf(!ready)('verification.live', () => {
  it('grounded answer is supported; planted hallucination is not', async () => {
    try {
      rmSync(DIR, { recursive: true, force: true });
    } catch {}

    const manager = createModelManager();
    const control = runtimeFor(RuntimeKind.Ollama).control;
    const embedder = makeEmbedder({
      ensureReady: (decl) => manager.ensureReady(decl),
      control,
      model: EMBED_MODEL,
    });
    const store = createMemoryStore(
      { path: DIR, embedModel: EMBED_MODEL },
      {
        embedTexts: embedder.embed,
        embedQuery: async (text) =>
          (await embedder.embed([text]))[0] as number[],
        probe: probeEmbedder,
      },
    );

    const verifyDeps = makeVerifyDeps({
      manager,
      control,
      generalModel: qwenRouter.model,
      store,
      space: SPACE,
    });

    try {
      const raftSource = 'raft-fact';
      const skySource = 'sky-fact';
      await store.remember(
        'The Raft consensus algorithm elects a leader via randomized election timeouts.',
        { space: SPACE, source: raftSource, at: Date.now() },
      );
      await store.remember('The sky appears blue due to Rayleigh scattering.', {
        space: SPACE,
        source: skySource,
        at: Date.now(),
      });
      const raftId = `${raftSource}#0`;
      const skyId = `${skySource}#0`;

      // Sanity: the chunk ids we're about to cite really resolve to the
      // expected text, so a failed assertion below points at the judge model
      // rather than a citation-id mismatch.
      const raftChunk = await store.getByIds(SPACE, [raftId]);
      expect(raftChunk[0]?.text).toMatch(/Raft/);

      const groundedAnswer = `Raft elects a leader using randomized election timeouts. [mem:${raftId}]`;
      const groundedVerdict = await verify(
        groundedAnswer,
        { query: 'how does raft elect a leader', space: SPACE },
        verifyDeps,
      );
      expect(groundedVerdict.supported).toBe(true);

      const hallucinatedAnswer = `The sky appears blue because it is reflecting the ocean. [mem:${skyId}]`;
      const hallucinatedVerdict = await verify(
        hallucinatedAnswer,
        { query: 'why is the sky blue', space: SPACE },
        verifyDeps,
      );
      expect(hallucinatedVerdict.supported).toBe(false);
      const joinedUnsupported = hallucinatedVerdict.unsupportedClaims
        .join('\n')
        .toLowerCase();
      expect(joinedUnsupported).toMatch(/ocean|reflecting/);
    } finally {
      store.close();
      await manager.unloadAll();
      try {
        rmSync(DIR, { recursive: true, force: true });
      } catch {}
    }
  }, 180_000);
});
