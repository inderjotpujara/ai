import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobProgress } from '../types.ts';
import { ExecMode, MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';
import { buildDiffusersFlags } from './safety.ts';

type ComfyQueueResponse = { prompt_id: string };

type ComfyHistoryEntry = {
  status?: { completed?: boolean; status_str?: string };
  outputs?: Record<
    string,
    { videos?: Array<{ filename: string; subfolder: string; type: string }> }
  >;
};

function comfyBaseUrl(): string {
  const host = process.env.AGENT_COMFY_HOST ?? '127.0.0.1';
  const port = process.env.AGENT_COMFY_PORT ?? '8188';
  return `http://${host}:${port}`;
}

/**
 * Minimal Wan text-to-video ComfyUI API graph. ComfyUI's `/prompt` endpoint
 * expects a full node graph (not just a prompt string); the node ids/class
 * names here follow the published Wan 2.x text-to-video workflow shape.
 * ComfyUI+Wan is NOT installed in this environment, so this graph has not
 * been exercised against a live server — live-verify (Slice 27 Phase C gate,
 * `MULTIMODAL_LIVE=1`) is the point where node wiring gets corrected against
 * a real workflow export if it doesn't match.
 */
export function buildWanWorkflow(
  prompt: string,
  opts: GenOpts,
): Record<string, unknown> {
  const width = opts.width ?? 832;
  const height = opts.height ?? 480;
  const steps = opts.steps ?? 20;
  const frames = (opts.seconds ?? 4) * 16;
  const workflow: Record<string, unknown> = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 0,
        steps,
        cfg: 6,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
      },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt },
    },
    '7': {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: { width, height, length: frames },
    },
    '8': {
      class_type: 'SaveVideo',
      inputs: {},
    },
  };

  // Safety-checker disable (D4): this is the only strategy a Diffusers/
  // ComfyUI safety checker exists for, and `opts` isn't threaded through
  // from a tool caller anywhere yet — so this is the single place
  // `disableSafetyChecker` gets its `uncensoredEnabled()` default applied
  // (see `buildDiffusersFlags`). When the checker is disabled, no checker
  // node is added to the graph at all (rather than adding a node and
  // configuring it off) — `safety_checker=None` is the equivalent flag for
  // callers that build a Diffusers pipeline directly instead of a ComfyUI
  // graph.
  const disableSafetyChecker = buildDiffusersFlags(opts).includes(
    'safety_checker=None',
  );
  if (!disableSafetyChecker) {
    workflow['9'] = {
      class_type: 'SafetyChecker',
      inputs: {},
    };
  }

  // Checkpoint from the gen-fit-selected repo (opts.model). Shape-only until
  // live-verify against a real ComfyUI export corrects the exact node wiring.
  if (opts.model) {
    workflow['10'] = {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: opts.model },
    };
  }

  return workflow;
}

async function fetchHistory(
  baseUrl: string,
  promptId: string,
): Promise<ComfyHistoryEntry | undefined> {
  const res = await fetch(`${baseUrl}/history/${promptId}`);
  if (!res.ok) return undefined;
  const history = (await res.json()) as Record<string, ComfyHistoryEntry>;
  return history[promptId];
}

/**
 * Server-lane Wan video generation strategy against a local ComfyUI
 * instance: POST /prompt to submit the workflow, poll /history for progress
 * and completion, then GET /view to fetch the produced video bytes and save
 * them to a temp path (the `result()` contract wants a produced-file path,
 * which `runServerJob` then hands to `MediaStore.putFile`).
 */
export const wanComfyStrategy: GenStrategy = {
  kind: MediaKind.Video,
  execMode: ExecMode.Server,
  async serverSubmit(prompt: string, opts: GenOpts) {
    const baseUrl = comfyBaseUrl();
    const clientId = randomUUID();
    const workflow = buildWanWorkflow(prompt, opts);

    const submit = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    if (!submit.ok) {
      throw new Error(`ComfyUI /prompt returned ${submit.status}`);
    }
    const { prompt_id: promptId } = (await submit.json()) as ComfyQueueResponse;

    async function poll(): Promise<JobProgress> {
      const entry = await fetchHistory(baseUrl, promptId);
      if (!entry) return { fraction: 0, message: 'queued' };
      if (entry.status?.completed) return { fraction: 1, message: 'completed' };
      return { fraction: 0.5, message: entry.status?.status_str ?? 'running' };
    }

    async function result(): Promise<string> {
      const entry = await fetchHistory(baseUrl, promptId);
      const video = entry?.outputs
        ? Object.values(entry.outputs).flatMap((o) => o.videos ?? [])[0]
        : undefined;
      if (!video) throw new Error('ComfyUI history had no video output');
      const view = new URLSearchParams({
        filename: video.filename,
        subfolder: video.subfolder,
        type: video.type,
      });
      const fileRes = await fetch(`${baseUrl}/view?${view.toString()}`);
      if (!fileRes.ok) {
        throw new Error(`ComfyUI /view returned ${fileRes.status}`);
      }
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      const outPath = join(tmpdir(), `comfy-${promptId}.mp4`);
      await Bun.write(outPath, bytes);
      return outPath;
    }

    return { poll, result };
  },
};
