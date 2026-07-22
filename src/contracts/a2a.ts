import { z } from 'zod';
import { JobKindWire } from './enums.ts';

/**
 * A2A (Agent-to-Agent) protocol v1.0 wire contracts — isomorphic. Mirrors the
 * JSON-RPC method/task/message/artifact/agent-card shapes from the A2A spec.
 * No engine mirror: this is the first introduction of these shapes on the
 * wire (Slice 31 Task 1), so there is no parity test against `src/`.
 */

/** JSON-RPC task lifecycle state — lowercase-hyphenated, the A2A wire casing. */
export enum TaskStateWire {
  Submitted = 'submitted',
  Working = 'working',
  Completed = 'completed',
  Failed = 'failed',
  Canceled = 'canceled',
  Rejected = 'rejected',
  InputRequired = 'input-required',
  AuthRequired = 'auth-required',
}

/** A2A JSON-RPC method names. */
export enum A2aMethod {
  MessageSend = 'message/send',
  MessageStream = 'message/stream',
  TasksGet = 'tasks/get',
  TasksCancel = 'tasks/cancel',
  TasksResubscribe = 'tasks/resubscribe',
}

export const PartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({
    kind: z.literal('file'),
    file: z.object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.string(),
    }),
  }),
  z.object({
    kind: z.literal('data'),
    data: z.record(z.string(), z.unknown()),
  }),
]);
export type A2aPart = z.infer<typeof PartSchema>;

export const MessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(PartSchema),
  messageId: z.string(),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
});
export type A2aMessage = z.infer<typeof MessageSchema>;

export const ArtifactSchema = z.object({
  artifactId: z.string(),
  name: z.string().optional(),
  parts: z.array(PartSchema),
});
export type A2aArtifact = z.infer<typeof ArtifactSchema>;

export const TaskStatusSchema = z.object({
  state: z.enum(TaskStateWire),
  message: MessageSchema.optional(),
  timestamp: z.string().optional(),
});
export type A2aTaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).default([]),
  history: z.array(MessageSchema).default([]),
  kind: z.literal('task'),
});
export type A2aTask = z.infer<typeof TaskSchema>;

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
});
export type A2aAgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  protocolVersion: z.literal('1.0'),
  url: z.string(),
  preferredTransport: z.string().default('JSONRPC'),
  skills: z.array(AgentSkillSchema),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
  }),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  securitySchemes: z.record(z.string(), z.unknown()),
  security: z.array(z.record(z.string(), z.array(z.string()))).default([]),
});
export type A2aAgentCard = z.infer<typeof AgentCardSchema>;

export const JsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable(),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

// ---------------------------------------------------------------------------
// A2A config console DTOs (Slice 31 Task 17) — the DEVICE-session-guarded
// (trusted-local) surface the Federation tab (Increment 7) reads/writes. These
// are distinct from the A2A-Bearer protocol shapes above: they configure the
// expose surface (enable state, skill allowlist, issued Bearer tokens) rather
// than carry the JSON-RPC protocol itself.
// ---------------------------------------------------------------------------

/** PUBLIC metadata of one issued A2A Bearer — mirrors `enroll.ts`'s
 *  `IssuedToken` (`{ id, label, createdAt }`). NEVER the raw token nor its
 *  on-disk fingerprint: the secret is transmitted exactly once, from
 *  `POST /api/a2a/token` (`A2aTokenIssueResponseSchema`), the
 *  `DevicePairResponseSchema` precedent. */
export const IssuedTokenSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.number(),
});
export type IssuedTokenWire = z.infer<typeof IssuedTokenSchema>;

/** Isomorphic wire form of Task 4's `SkillEntry` (`src/a2a/allowlist.ts`).
 *  `kind` is a `JobKindWire` — this is the schema that finally CONSUMES the
 *  `JobKindWire` import in the wire layer (keeping the Task 1 introduction
 *  lint-clean). Wire↔engine (`JobKindWire`↔`JobKind`) are value-identical
 *  string enums (`tests/contracts/job-kind-parity.test.ts`). */
export const A2aSkillEntryWireSchema = z.object({
  skillId: z.string().max(128),
  name: z.string().max(200),
  description: z.string().max(2000),
  kind: z.enum(JobKindWire),
  ref: z.string().max(128),
});
export type A2aSkillEntryWire = z.infer<typeof A2aSkillEntryWireSchema>;

/** `GET /api/a2a/config` response — the full trusted-local config view:
 *  enable state, exposed skills, a preview of the advertised agent card, and
 *  issued-token METADATA. It NEVER carries a raw token (that is `issue`-only). */
export const A2aConfigResponseSchema = z.object({
  enabled: z.boolean(),
  skills: z.array(A2aSkillEntryWireSchema),
  cardPreview: AgentCardSchema,
  tokens: z.array(IssuedTokenSchema),
});
export type A2aConfigResponse = z.infer<typeof A2aConfigResponseSchema>;

/** `PUT /api/a2a/skills` body — the desired exposed-skill set. Each entry's
 *  `ref` is re-validated against the in-process registries (§7.4
 *  least-privilege) before it is persisted; an unknown ref → 400. */
export const A2aSkillsPutRequestSchema = z.object({
  skills: z.array(A2aSkillEntryWireSchema).max(100),
});
export type A2aSkillsPutRequest = z.infer<typeof A2aSkillsPutRequestSchema>;

/** `POST /api/a2a/token` body — mint a new A2A Bearer with a display label. */
export const A2aTokenIssueRequestSchema = z.object({ label: z.string() });
export type A2aTokenIssueRequest = z.infer<typeof A2aTokenIssueRequestSchema>;

/** `POST /api/a2a/token` response — the minted id + the raw Bearer, transmitted
 *  EXACTLY ONCE (the `DevicePairResponseSchema` precedent). The token is never
 *  persisted raw nor re-listed by `GET /api/a2a/config`. */
export const A2aTokenIssueResponseSchema = z.object({
  id: z.string(),
  token: z.string(),
});
export type A2aTokenIssueResponse = z.infer<typeof A2aTokenIssueResponseSchema>;

// ---------------------------------------------------------------------------
// A2A remote store DTOs (Slice 31 Task 22) — the CONSUME-side counterpart to
// the config console above: which remote peers THIS node delegates to, added
// via `POST /api/a2a/remotes` (discover-then-pin) and listed via
// `GET /api/a2a/remotes`. Distinct credential domain from the expose-side
// tokens: a remote's `token` is ITS Bearer, sent outbound to `baseUrl`, and —
// like the expose-side secret — is NEVER round-tripped onto the wire once
// stored (`a2a/remotes.ts`).
// ---------------------------------------------------------------------------

/** Wire DTO for one discovered+pinned remote. OMITS `token` — the remote's
 *  Bearer lives only in the server-side store (`a2a/remotes.ts`) and must
 *  never reach a client, span, or log. `skillId` (the delegation target chosen
 *  at add-time, Task 30-FIX) is NOT secret and DOES appear here. */
export const A2aRemoteDtoSchema = z.object({
  name: z.string(),
  baseUrl: z.string(),
  cardUrl: z.string(),
  pinnedCardHash: z.string(),
  skillId: z.string(),
});
export type A2aRemoteDto = z.infer<typeof A2aRemoteDtoSchema>;

/** `GET /api/a2a/remotes` response. */
export const A2aRemoteListResponseSchema = z.object({
  remotes: z.array(A2aRemoteDtoSchema),
});
export type A2aRemoteListResponse = z.infer<typeof A2aRemoteListResponseSchema>;

/** `POST /api/a2a/remotes` body — add a remote. The server discovers +
 *  pins `cardUrl` BEFORE persisting (a failed discover is a 400, nothing
 *  stored); `token` is the remote's Bearer, stored but never echoed back. */
export const A2aRemoteAddRequestSchema = z.object({
  // Constrained to the delegate-tool charset (the same pattern `delegateToolName`
  // + the local `AGENT` keys assume): as of Task 29b this name becomes a LIVE
  // `delegate_to_<name>` AI-SDK tool key handed to the router model AND a line in
  // `buildRoutingPrompt`'s catalog. A space/special char would be an invalid
  // provider tool name (turn breakage) and a newline would inject a routing-prompt
  // line — so reject anything outside `[a-zA-Z0-9_-]{1,64}` at the schema edge.
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  cardUrl: z.string().min(1).max(2048),
  token: z.string().min(1),
  // Optional operator-chosen delegation target (Task 30-FIX). When omitted the
  // server auto-picks a sole-skill card and rejects an ambiguous/empty one; when
  // present it must be a skill the discovered card advertises (`resolveSkillId`).
  skillId: z.string().min(1).max(128).optional(),
});
export type A2aRemoteAddRequest = z.infer<typeof A2aRemoteAddRequestSchema>;

/** `POST /api/a2a/remotes/test` body — dry-run discover/validate/pin of a
 *  card URL; nothing is persisted regardless of outcome. */
export const A2aRemoteTestRequestSchema = z.object({
  cardUrl: z.string().min(1).max(2048),
});
export type A2aRemoteTestRequest = z.infer<typeof A2aRemoteTestRequestSchema>;

/** `POST /api/a2a/remotes/test` response — the discovered card + the hash
 *  that WOULD be pinned were this an Add. The store is untouched by this
 *  route (`server/a2a/remotes-test.ts`). */
export const A2aRemoteTestResponseSchema = z.object({
  card: AgentCardSchema,
  pinnedCardHash: z.string(),
});
export type A2aRemoteTestResponse = z.infer<typeof A2aRemoteTestResponseSchema>;
