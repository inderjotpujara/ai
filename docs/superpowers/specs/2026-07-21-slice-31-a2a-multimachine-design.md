# Slice 31 — Multi-Machine + A2A Interop (web-focused)

**Status:** design · 2026-07-21 · branch `slice-31-a2a-multimachine` (off `main`)
**Predecessor:** Slice 24 shipped the always-on daemon + SQLite job queue (`POST /api/jobs` → `handleJobEnqueue` `src/server/jobs/enqueue.ts:71`; `JobStore.enqueue`; SSE run stream `src/server/runs/stream.ts:53`; durable root/session tokens `src/server/security/{root-token,session-token,token}.ts`; loopback-only device pairing `src/server/devices/pair.ts:45` behind `requireTrustedLocal` `src/server/security/trusted-local.ts:16`). Slice 25/25b shipped triggers + the Ops console (`web/src/features/ops/` — Overview/Jobs/Triggers/Devices tabs; MCP add/test-mount flow is the UI analog for "add a remote agent"). Slice 15 shipped the MCP mount registry (`mountAll` → `MountedRegistry.forAgent` → scoped `toolsFor`) — the CONSUME-side analog this slice reuses wholesale.
**Unblocks:** the remote-access-from-anywhere requirement's *delegation* half (memory `remote-access-requirement`); positions the framework as an interop citizen (call out to, and be called by, other A2A agents).

---

## 1. Summary

Slice 31 puts **one A2A v1.0 layer** over the shipped daemon + queue and drives it entirely from the web console. The thesis (locked, matches `docs/diagrams/slice-31-a2a-multimachine/a2a-interop.png`): **multi-machine delegation IS A2A** — there is no separate bespoke multi-machine path. The Mac Mini daemon becomes an **A2A server** (peers call our orchestrator); the laptop becomes an **A2A client** (we delegate to remote agents). Both directions ship together.

- **EXPOSE.** The daemon serves an Agent Card at `GET /.well-known/agent-card.json` and a JSON-RPC endpoint at `POST /api/a2a`. `message/send` maps an inbound A2A task onto the **existing Slice-24 queue** (`JobStore.enqueue`) and returns a `Task` in `submitted`; the worker flips it `working → completed/failed`; `message/stream` re-frames the existing run-stream machinery as A2A `TaskStatusUpdate`/`TaskArtifactUpdate` SSE events. `OrchestratorResult` maps to task states (answer→completed, gap/resource→failed, consent→input-required).
- **CONSUME.** A Federation-tab "Add remote agent" dialog (mirroring the MCP add/test-mount flow) fetches + validates + **pins** a peer's card hash, then mounts the remote agent **through the MCP mount path** (`mountAll` → `forAgent`) as a `ToolSet` — so it surfaces to the orchestrator as a `delegate_to_<name>` specialist that inherits the existing guardrails, breaker, and `agent.delegation` telemetry.
- **Web-focused.** Every operator/authoring/monitoring surface lives in a new **Federation** tab under `web/src/features/ops/`. Backend routes/modules exist server-side, but the primary UX is the browser. A thin `agent a2a …` CLI is an optional fallback only.
- **We hand-roll the A2A v1.0 JSON-RPC subset** (agent card, `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `tasks/resubscribe`) rather than adopt `@a2a-js/sdk` (npm is 0.3.x; v1.0 lives only on a beta branch) — fits the repo's minimal-dep, provider-agnostic posture and targets v1.0.0 directly.

## 1.1 Use cases — and why A2A when the web UI already reaches the Mac Mini

**Explicitly NOT the value prop (already shipped):** a *human* opening the Mac-Mini web console in Chrome — locally or from a laptop/phone over Tailscale — already delegates all compute to the Mac Mini. That is delivered by Slice 24 (daemon + queue + tunnel bind + session tokens), Slice 25b (device pairing/QR), and Slice 30b (the full web UI). A2A adds **nothing** to the human-in-a-browser remote case; do not justify this slice on it.

**What A2A uniquely enables — no human, no browser (programmatic / agent-to-agent):**
- **CONSUME:** the orchestrator delegates a whole sub-task to *another agent* mid-run (a peer box, or a third-party A2A agent) and gets an artifact back — engine-to-engine, autonomous, inside a crew/workflow.
- **EXPOSE:** non-human callers drive our orchestrator — n8n, cron, a shell script, or *another* CrewAI/agent framework invokes it as one step in *their* pipeline (the local "n8n × CrewAI backend" story).
- **Ecosystem interop:** mount external A2A agents (AWS/Google/MS et al.) as specialists, the way MCP servers mount today.

**Decision (user-confirmed 2026-07-21):** proceed with BOTH directions now — build the interop foundation even though the human-remote case is already covered. This slice is opt-in (`AGENT_A2A_ENABLED` off by default), so it costs nothing until an allowlist/remote is configured.

## 2. Goals / non-goals

**Goals:** one A2A v1.0 layer serving BOTH multi-machine delegation and agent interop; EXPOSE our orchestrator (card + JSON-RPC + SSE, task states mapped onto the queue) with a **least-privilege skill allowlist**; CONSUME external A2A agents as mounted `delegate_to_<name>` specialists (discover → validate → pin → mount, reusing the MCP mount path); a **separate out-of-band A2A Bearer** credential issued/revoked from the console that solves the loopback-only enrollment gap; isomorphic A2A contracts; the Federation tab as the primary UX + a thin CLI fallback; new `a2a.*` telemetry reusing `agent.delegation` on the consume side; a real two-machine live-verify over Tailscale.

**Non-goals / out of scope (chartered elsewhere or deliberately deferred — NOT debt):**
- **No A2A `pushNotifications`** (webhook callbacks for long tasks) — card advertises `capabilities.pushNotifications:false`; clients poll via `tasks/get` or hold the SSE. (A future slice may add it, reusing the Slice-25 webhook receiver as the callback sink.)
- **No CloudEvents / gRPC / gRPC-web transports** — A2A v1.0 permits them; we implement only JSON-RPC-2.0-over-HTTP+SSE.
- **No multi-peer mesh / peer discovery / registry** — a peer is added explicitly by pasting its card URL + token. No gossip, no service directory.
- **No OAuth/OIDC or mTLS `securitySchemes`** — HTTP Bearer only this slice (the card *advertises* the scheme; adding others is additive later).
- **No agent-card *generation* from chat** (a "Federation builder" is a later slice; splice markers only if cheap).
- **No `@a2a-js/sdk` adoption** — locked (D1). No re-litigation.
- **Not multi-machine job *scheduling*** — a single daemon still owns its queue (Slice 24 D-series). A2A delegates a *task*; it does not distribute the scheduler.
- **No new tunnel transport** — reuses Slice 24's pluggable bind-address + Tailscale-default recipe; A2A adds no transport of its own.

## 3. Decisions (D1..D7)

### D1 — Unify on A2A v1.0; hand-roll the JSON-RPC subset; new `src/a2a/`
One layer, both directions (locked). A2A v1.0.0 (Linux Foundation, Apr 2026) transport = **JSON-RPC 2.0 over HTTP + SSE**. We implement exactly six methods — `message/send`, `message/stream` (SSE), `tasks/get`, `tasks/cancel`, `tasks/resubscribe` — plus the card at `GET /.well-known/agent-card.json`. **Hand-rolled** (D-locked: `@a2a-js/sdk` is 0.3.x on npm, v1.0 only on a beta branch; the subset is small and the repo prefers minimal deps + provider-agnostic ports). Modules (small, loosely-coupled, per repo code style):
- **`src/a2a/card.ts`** — build + serve the Agent Card from the curated skill allowlist (D2); ETag + `Cache-Control`.
- **`src/a2a/server.ts`** — the JSON-RPC handler behind the new route `POST /api/a2a`; Bearer verify → parse → dispatch by `method`; task-state mapping via `task-map.ts`; SSE for `message/stream` / `tasks/resubscribe`.
- **`src/a2a/client.ts`** — CONSUME side: discover (`GET` card) → validate → pin hash → invoke (`message/send` / `message/stream`) against a **remote base URL** with the per-remote Bearer.
- **`src/a2a/task-map.ts`** — the `OrchestratorResult` ↔ A2A `Task`-state bijection incl. the `input-required` consent round-trip (§7.1).
- **`src/a2a/enroll.ts`** — A2A Bearer issue/verify/revoke (D5) + the per-remote client store.
- **`src/contracts/a2a.ts`** — isomorphic Zod types (D6).
- **`src/cli/a2a.ts`** — thin fallback CLI (D7).

### D2 — Agent Card + LEAST-PRIVILEGE skill allowlist (the EXPOSE discovery surface)
`card.ts` builds a v1.0 card served at `GET /.well-known/agent-card.json` (the v1.0 path — **NOT** the legacy `agent.json`) with ETag + `Cache-Control`. Fields: `name, description, version, protocolVersion:"1.0", url` (the tailnet `POST /api/a2a` URL), `skills[]`, `capabilities{streaming:true, pushNotifications:false}`, `defaultInputModes, defaultOutputModes, securitySchemes` (one HTTP Bearer scheme), `security`.
- **The allowlist is the security boundary.** `skills[]` is derived from an **explicit allowlist** persisted server-side (`a2a-skills.json`-equivalent, authored in the Federation tab), mapping each exposed `skillId → { kind: JobKind, ref }` where `ref` names a registered agent (`AGENTS` `agents/index.ts:14`), crew, or workflow. **Never** a "run anything" / free-form-orchestrator skill — an unlisted agent/crew/workflow is not reachable (§7.4). Empty allowlist ⇒ card served with `skills:[]` (nothing callable).
- The card is served **outside** the `/api` session guard (public discovery, same as `/.well-known` conventions) but the `POST /api/a2a` endpoint it points to requires Bearer (D5) — discovery is public, invocation is authenticated.

### D3 — EXPOSE: JSON-RPC server + task-state mapping onto the Slice-24 queue
New route **`POST /api/a2a`** in `src/server/app.ts` (its own route class; action-path ordering per the existing `app.ts` if-ladder). Flow:
- **`message/send`** → verify Bearer → resolve the target skill from `params` against the allowlist → `JobStore.enqueue` with the mapped `JobKind` + a payload built from the inbound `Message.parts` (treated as UNTRUSTED, §7.2) → return `Task { id, contextId, status:{ state:"submitted" }, history:[msg] }`. The A2A `taskId` is the queue `jobId` (or a stable 1:1 map); `contextId` groups a multi-turn conversation.
- **`message/stream`** → same enqueue, then an SSE stream that **re-frames the existing run-stream machinery** (`handleRunStream` `src/server/runs/stream.ts:53`, `Last-Event-ID` replay by wire order) as A2A `TaskStatusUpdateEvent` (`submitted → working → completed/failed`) and `TaskArtifactUpdateEvent` (text/data artifacts). No parallel streaming path — one SSE engine, two framings.
- **`tasks/get`** → read job status/result via `getJob`, project to `Task`. **`tasks/cancel`** → fire the existing job `AbortSignal` (the `/api/jobs/:id/cancel` path) → task `canceled`. **`tasks/resubscribe`** → re-attach an SSE stream to a running task using `Last-Event-ID` replay.
- **Task-state mapping (`task-map.ts`), JSON-RPC lowercase-hyphenated casing:**

  | Source | A2A task state | Notes |
  |---|---|---|
  | enqueued | `submitted` | initial `message/send` response |
  | worker claims job | `working` | first `TaskStatusUpdateEvent` |
  | `OrchestratorResult{kind:'answer'}` | `completed` | `TaskArtifactUpdate` with a text part |
  | `OrchestratorResult{kind:'gap'}` | `failed` | typed error `missing-capability` + `missingCapability` |
  | `OrchestratorResult{kind:'resource'}` | `failed` | typed error `resource` + message |
  | consent needed mid-run | `input-required` | consent back-channel over the wire (§7.1) |
  | Bearer/allowlist reject | JSON-RPC error / `rejected` | pre-enqueue (never reaches a model) |
  | `tasks/cancel` | `canceled` | AbortSignal |

### D4 — CONSUME: discover → validate → PIN → mount-as-delegate via the MCP mount path
`client.ts` consumes a remote A2A agent as a specialist. The Federation "Add remote agent" dialog mirrors the MCP add/test-mount flow (`POST /api/mcp/add`, `POST /api/mcp/test-mount`):
1. **Fetch** the peer card (`GET <cardUrl>`) with `redirect:'error'` (SSRF guard, reused from the `@ai-sdk/mcp` hardening — §7.3).
2. **Validate** against `AgentCardSchema` (D6); reject `protocolVersion !== "1.0"`.
3. **Pin** a SHA-256 of the canonicalized card body → `pinnedCardHash` (§7.3). A later card whose hash differs from the pin is rejected (spoofing / rug-pull defense — the tools-hash-pinning idiom from `mountAll` `src/mcp/client.ts`).
4. **Mount** through the existing MCP mount path: `client.ts` exposes the remote's `skills[]` as a `ToolSet` (one tool per skill, `execute` = `message/send`/`message/stream` against the remote) and registers it via `mountAll` (`src/mcp/mount.ts:98`) → `MountedRegistry.forAgent(name)` (`mount.ts:204`) → scoped into `createSuperAgent` `toolsFor` (`agents/super.ts:33`). The mounted remote therefore becomes a `delegate_to_<name>` specialist that **inherits the guardrails, depth-guard, breaker, and `agent.delegation` span** for free (`src/core/delegate.ts:122`, `runGuardedAgent`). Consent + hash-pinning reuse `mountAll`'s existing consent flow.
- The **client-side transport is new**: today's browser client is same-origin-relative; `client.ts` is a non-browser HTTP+SSE caller against an arbitrary **remote base URL** with a stored Bearer (the missing piece per the substrate audit).

### D5 — Auth & enrollment: a SEPARATE out-of-band A2A Bearer that solves the loopback gap
`requireTrustedLocal` (`src/server/security/trusted-local.ts:16`, verified: principal `'local'` + **loopback** Host + allowed origin) means a remote laptop **cannot self-pair** via `POST /api/devices` — the enrollment gap. A2A does **not** try to reuse device pairing. Instead:
- **A2A gets its OWN long-lived Bearer**, HMAC-derived from the existing **root token** (`src/server/security/root-token.ts`, `~/.agent/daemon-token` 0600), **revocable**, minted/revoked **from the Federation tab** (issuing itself is a `requireTrustedLocal` action — you enroll a peer from the physically-local browser) and **printed once**. This is distinct from browser/device-pairing session tokens (`mintSessionToken`/`verifySessionToken` `src/server/security/session-token.ts:95,103`). `enroll.ts` owns issue/verify/revoke; verification is the constant-time compare already in `security/`.
- **Two distinct "remote-auth" meanings, kept explicit** (the docs already flag this): **A2A Bearer = credential *to* a remote agent / *for* a peer calling us**; **Slice-24 device pairing = a device's session token *to our own daemon's* `/api` surface.** They never mix — the `POST /api/a2a` route accepts only the A2A Bearer, not a device session token, and vice-versa.
- **Consume-side store:** per-remote `{ name, baseUrl, cardUrl, token, pinnedCardHash }` in `~/.config/ai/a2a-remotes.json` (0700 dir / 0600 file, the `~/.agent` idiom). **Expose-side store:** the skill allowlist + issued-token registry (`a2a-skills.json`-equivalent) authored via the console; the token secret is stored hashed, never round-tripped to a DTO or a span.
- **Network is NOT the trust boundary** (same posture as Slice 24): bind the tailnet interface + loopback, never `0.0.0.0`; Bearer required on every `POST /api/a2a`; the Host/Origin perimeter still applies.

### D6 — Isomorphic A2A contracts (`src/contracts/a2a.ts`)
Zod schemas with wire+domain parity, guarded by parity tests (the `src/contracts/` convention, e.g. `tests/contracts/*`): `AgentCardSchema`, `MessageSchema` (`role: user|agent` + `parts[]` + `contextId`/`taskId`), `TaskSchema` (`id, contextId, status, artifacts[], history[]`), `ArtifactSchema` (`parts[]`), `PartSchema` (discriminated union: `text | file/bytes | data`), `TaskStateWire` enum (`submitted|working|completed|failed|canceled|rejected|input-required|auth-required` — lowercase-hyphenated), and the JSON-RPC envelope schemas (`JsonRpcRequest`/`JsonRpcResponse`/`JsonRpcError`). Enum-over-union per repo style for the finite state set. These schemas are the single validation surface both `server.ts` (inbound) and `client.ts` (peer card + responses) use.

### D7 — Web console Federation tab (primary UX) + thin CLI fallback + API routes
- **API (server-side, backing the tab):** `GET /api/a2a/config` (allowlist + card preview + issued-token metadata), `PUT /api/a2a/skills` (edit allowlist), `POST /api/a2a/token` (issue) + `DELETE /api/a2a/token/:id` (revoke), `GET`/`POST`/`DELETE /api/a2a/remotes` (consume registry CRUD), `POST /api/a2a/remotes/test` (the discover→validate→pin dry-run, mirroring `test-mount`). **All mutating A2A routes sit behind `requireTrustedLocal`** — issuing an exposure token or adding a remote is privileged config. (The A2A *protocol* endpoint `POST /api/a2a` is separate and Bearer-gated, D3/D5.)
- **Console (primary):** new `web/src/features/ops/federation-tab.tsx` with two panels — **Expose** (skill-allowlist editor, live card preview, issue/revoke token showing the secret once) and **Consume** (remote list, "Add remote agent" dialog = paste cardUrl+token → validate+pin → mount, mirroring the MCP tab). Watch a remote task in the **existing Runs waterfall** (Phase 3 viewer). Plain `apiFetch(path,{schema})` hooks, no query lib, matching the other Ops tabs; `data-testid="ops-federation"`.
- **CLI (thin fallback only):** `src/cli/a2a.ts` mirroring the daemon-CLI injected-deps shape: `agent a2a skills|token|remotes|call|card`.

## 4. Backend-delta table

| Capability | Reachable today? | Route / module / store to ADD | Request → Response |
|---|---|---|---|
| Agent Card | ✗ | `src/a2a/card.ts`; `GET /.well-known/agent-card.json` | — → card JSON (ETag) |
| A2A JSON-RPC server | ✗ | `src/a2a/server.ts`; `POST /api/a2a` (Bearer) | JSON-RPC → `Task` / SSE |
| Task-state mapping | ✗ | `src/a2a/task-map.ts` | `OrchestratorResult` ↔ `Task` |
| A2A client (remote base URL + SSE) | ✗ | `src/a2a/client.ts` | discover/validate/pin/invoke |
| Consume-as-delegate | reuse | mount via `mountAll`→`forAgent`→`toolsFor` | remote → `delegate_to_<name>` |
| A2A Bearer issue/verify/revoke | ✗ | `src/a2a/enroll.ts` (HMAC-from-root) | — |
| Expose allowlist + token registry | ✗ | `a2a-skills.json`-equiv (console-authored) | — |
| Consume remote store | ✗ | `~/.config/ai/a2a-remotes.json` (0600) | — |
| Contracts | ✗ | `src/contracts/a2a.ts` (Zod + parity tests) | — |
| Config/preview API | ✗ | `GET /api/a2a/config`, `PUT /api/a2a/skills` (trusted-local) | → config DTO |
| Token API | ✗ | `POST /api/a2a/token`, `DELETE /api/a2a/token/:id` (trusted-local) | → token-once / 200 |
| Remotes API | ✗ | `GET`/`POST`/`DELETE /api/a2a/remotes`, `POST /api/a2a/remotes/test` (trusted-local) | → remote DTO(s) |
| Queue enqueue (inbound task) | reuse | `JobStore.enqueue` (`src/server/jobs/enqueue.ts:71`) | mapped `JobKind`+payload |
| SSE task stream | reuse (re-framed) | `handleRunStream` `src/server/runs/stream.ts:53` | run events → A2A events |
| CLI | ✗ | `src/cli/a2a.ts` | — |

## 5. Increment breakdown (SUGGESTION — the plan skill finalizes)

1. **Contracts** — `src/contracts/a2a.ts` (card/message/task/artifact/part + JSON-RPC envelopes + `TaskStateWire`); parity tests (the `JobKindWire` precedent).
2. **EXPOSE card + allowlist** — `card.ts`, the allowlist store + skill→`JobKind` resolution, `GET /.well-known/agent-card.json` (ETag/Cache-Control, `skills:[]` when empty).
3. **EXPOSE server** — `server.ts` + `task-map.ts`; `POST /api/a2a` `message/send` → enqueue → `submitted`; `tasks/get`/`tasks/cancel`; the `OrchestratorResult`→state mapping.
4. **EXPOSE streaming** — `message/stream` / `tasks/resubscribe` re-framing the run-stream as `TaskStatusUpdate`/`TaskArtifactUpdate`; the `input-required` consent round-trip (§7.1).
5. **Auth & enrollment** — `enroll.ts` (A2A Bearer HMAC-from-root, verify/revoke); Bearer gate on `POST /api/a2a`; token issue/revoke API; the two-stores split (D5).
6. **CONSUME** — `client.ts` (remote HTTP+SSE, discover→validate→PIN, `redirect:'error'`); mount-as-`ToolSet` via `mountAll`→`forAgent`; the `a2a-remotes.json` store + remotes API.
7. **Console Federation tab** — Expose + Consume panels; add-remote dialog mirroring MCP test-mount; watch-remote-task via the Runs waterfall. Thin `src/cli/a2a.ts`.
8. **Docs (4 surfaces) + SDD ledger + live-verify + land** (§8/§10).

## 6. Web IA wiring (exact touch-points)

- `web/src/features/ops/` — new `federation-tab.tsx` (Expose + Consume panels), `add-remote-dialog.tsx` (paste cardUrl+token → validate+pin, mirrors the MCP add/test-mount dialog), `skill-allowlist-editor.tsx`, `card-preview.tsx`, `token-issue.tsx` (secret shown once), `use-a2a-config.ts` / `use-a2a-remotes.ts` hooks.
- Register the tab in the Ops console tab bar beside Overview/Jobs/Triggers/Devices; `data-testid="ops-federation"`.
- Watching a remote task reuses the **existing Runs waterfall** (`web/src/features/runs/`, Phase 3) — no new viewer.
- All data via `apiFetch(path,{schema})` with the new `src/contracts/a2a.ts` schemas — the device session Bearer is automatic; no query lib.

## 7. Hard parts (adversarial / ultracode / Fable verification)

- **7.1 `OrchestratorResult` ↔ A2A task-state mapping + the `input-required` consent round-trip over the wire.** The consent back-channel now crosses machines: a mid-run consent request must surface as `input-required` (with the prompt in a `Message`/`Part`), the remote caller's reply must resume the *same* task/`contextId`, and a timeout/refusal must land as a typed `failed` — not a hang. This is the correctness-critical mapping (state machine + resume identity + no lost/duplicated consent).
- **7.2 Inbound-task AUTH + UNTRUSTED-CONTENT boundary.** Bearer verify (constant-time) **before** parsing the JSON-RPC body; inbound `Message.parts` treated as **UNTRUSTED** before they reach a model — reuse the existing delimited-untrusted-transcript handling (never let inbound task text act as instructions to the orchestrator); a replay window/nonce on the request; body-size cap (reuse `maxRequestBodySize`); the Bearer secret never in logs / DTOs / spans.
- **7.3 CONSUME-side card spoofing / hash-pinning / SSRF.** Card fetched with `redirect:'error'` (reuse the `@ai-sdk/mcp` SSRF guard); the pinned SHA-256 must be over a **canonicalized** card body (stable field ordering) so a benign re-serialize doesn't false-trip and a malicious field-swap can't slip under the hash; a hash mismatch on re-fetch is a hard reject, surfaced in the console. No fetching non-tailnet/loopback-escaping URLs beyond the operator-pasted `cardUrl`.
- **7.4 Least-privilege skill exposure.** The allowlist is the whole boundary: an agent/crew/workflow **not** in `a2a-skills.json` must be uncallable via `message/send` (resolve-then-reject, never a fall-through to a generic orchestrator run); no "run anything" skill can be authored; the mapping `skillId → { kind, ref }` is validated at author-time and re-checked at invoke-time.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update (`docs/architecture.md`).** Add a new subsystem section **"§ `src/a2a/` — A2A interop"** (card → JSON-RPC server → task-map onto the queue → client → enroll; the EXPOSE and CONSUME data-flow lanes matching the diagram). Update **§24 (daemon/queue)** to document the new `POST /api/a2a` route class + `GET /.well-known/agent-card.json` served outside the `/api` guard, and the inbound-task → `JobStore.enqueue` edge. Update **§14 (MCP mount registry)** to note the consume-side reuse (remote A2A agent mounted as a `ToolSet` via `mountAll`→`forAgent`). Update the **Jobs & Triggers Ops Console** section for the new **Federation tab**, and the **module map / doc-map / README pointer** if a living doc is added. Regenerate the interactive architecture-snapshot **Artifact** (new `a2a` node + edges to Queue/Daemon/MCP/Ops-console + the two external-peer nodes; updated footer slice count "31" + test count). `bun run docs:check` + the pre-push slice-landing gate hard-fail until `README.md`, `docs/ROADMAP.md`, and `.superpowers/sdd/progress.md` are updated in the same push.

**Telemetry to emit.** New spans via the existing `inSpan`/`ATTR` conventions (`src/telemetry/spans.ts` — no parallel emission path, no-op without a tracer): `a2a.server.task` (inbound: method, skillId, mapped `JobKind`, final task state, outcome), `a2a.server.card` (card served / cache hit), `a2a.client.discover` (fetch+validate+pin outcome), `a2a.client.invoke` (remote base URL host only, method, task state). The consume-side delegation **reuses the existing `agent.delegation` span** (`src/telemetry/spans.ts:447`) — no duplicate span for the mounted-remote hop. New `ATTR` keys: `A2A_METHOD`, `A2A_SKILL_ID`, `A2A_TASK_STATE`, `A2A_PEER_HOST`, `A2A_OUTCOME`. **No secret values** (no Bearer, no full card body, no untrusted task text) in any span/attr. Server-request-scoped spans nest under `withServerRequestSpan` as the other routes do.

## 9. Testing strategy

- **Contracts.** DTO round-trips + wire-enum parity for `TaskStateWire`/`Part` union (the `JobKindWire` precedent); reject `protocolVersion !== "1.0"`.
- **EXPOSE server (mocked queue).** `message/send` → `submitted` + a job enqueued with the mapped `JobKind`; each `OrchestratorResult` variant → the correct task state (answer/gap/resource/consent); `tasks/cancel` fires the AbortSignal; unlisted skill → reject (7.4); bad/absent Bearer → 401 before parse (7.2); over-cap body → 413; replayed request → rejected.
- **Streaming (fake stream).** `message/stream` emits `TaskStatusUpdate` submitted→working→completed and a `TaskArtifactUpdate`; `tasks/resubscribe` replays by `Last-Event-ID`; the `input-required` round-trip resumes the same `contextId` (7.1).
- **CONSUME client (mock peer).** discover→validate→pin happy path; hash-mismatch on re-fetch → hard reject (7.3); `redirect:'error'` blocks a redirecting card host; a mounted remote surfaces as `delegate_to_<name>` and inherits the breaker/`agent.delegation` span.
- **Enrollment.** A2A Bearer verify is constant-time; revoke invalidates; an A2A Bearer is not accepted on `/api` device routes and a device session token is not accepted on `POST /api/a2a` (D5 separation).
- **Live-verify.** §10.

## 10. Live-verify gate (mandatory before merge)

**⚠️ Two-box over Tailscale — the second Mac (`100.121.49.105`) is normally powered OFF. This step must be flagged to the user in advance so they power it on.** This box = A2A **client**; second Mac = A2A **server**.

**Deterministic CI portion (single-box loopback, gated `.live` off for the cross-machine part):** on one box, EXPOSE + CONSUME against itself — card fetch, `message/send` a real run → streamed artifacts → `completed`; bad token → 401; altered card hash → rejected; unlisted skill → not callable.

**Real cross-machine portion (over Tailscale, second Mac powered on, launchd daemon + real Ollama):**
1. **Discover** — from this box fetch the peer's `GET /.well-known/agent-card.json`; validate + pin the hash.
2. **Delegate** — `message/send` a **real crew run** from this box to the peer → `submitted → working` → **streamed artifacts back** → `completed`; the run is watchable in the peer's Runs waterfall.
3. **Cancel** — `tasks/cancel` a running remote task → `canceled`; the peer's job actually aborts.
4. **Bad token** — a wrong/absent Bearer on `POST /api/a2a` → **401**.
5. **Spoofed card** — re-fetch a peer card whose body was altered so the hash differs from the pin → **rejected** (7.3).
6. **Least-privilege** — attempt `message/send` to a skill **not** in the peer's allowlist → **rejected**, never runs (7.4).
   Throughout: `a2a.*` spans present and secret-free; the two-stores separation holds (A2A Bearer ≠ device session token).

## 11. New deps & env knobs

**Deps:** none required (hand-rolled JSON-RPC + SSE over the existing server; card hashing via Node `crypto`). `@a2a-js/sdk` explicitly **not** adopted (D1).
**Env (all via `src/config/schema.ts`, defaults computed/conventional — never hardcoded, per the repo rule):** `AGENT_A2A_ENABLED` (expose on/off, default off until an allowlist exists), `AGENT_A2A_CARD_TTL` (card `Cache-Control` max-age), `AGENT_A2A_REPLAY_WINDOW_MS` (inbound replay window, ~5 min), `AGENT_A2A_REMOTES_PATH` (consume store override, mirroring `AGENT_QUEUE_PATH`), `AGENT_A2A_SKILLS_PATH` (expose allowlist override). The advertised card `url` derives from the existing Slice-24 bind-address / tunnel-origin config — no new transport knob.
