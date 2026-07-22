### Task 10: Wire `POST /api/a2a` route (session-guard exception)

**Files:**
- Create: `src/server/a2a/rpc.ts`
- Modify: `src/server/app.ts` (the `/api/telemetry`-style session-guard exception at `app.ts:290`, + the route in `handleApi`)
- Test: `tests/server/a2a-rpc-route.test.ts`

**Interfaces:**
- Consumes: `dispatchA2aRpc`, `A2aServerDeps` (Task 9); `JsonRpcRequestSchema`, `JsonRpcResponseSchema` from `../contracts/index.ts`; `deps.a2a` (grown to carry `{ allowlist, jobStore, runsRoot, taskIndex }`).
- Produces:
  - `src/server/a2a/rpc.ts`: `handleA2aRpc(req: Request, deps: A2aServerDeps): Promise<Response>` — parse the JSON-RPC envelope, `dispatchA2aRpc`, wrap the result/error as a `JsonRpcResponse` (same `id`). **(Bearer verification is added in Task 16 — this task wires the reachable route; the whole surface is gated by `AGENT_A2A_ENABLED` and, in Task 16, the A2A Bearer.)** 404 when `AGENT_A2A_ENABLED` off.
  - `app.ts`: extend the beacon-style guard exception (`app.ts:290`) so `POST /api/a2a` is let past the **device session** guard (it authenticates with the **A2A Bearer**, not a device token — the D5 two-stores split); the handler owns its own auth. In `handleApi`, add `if (req.method === 'POST' && url.pathname === '/api/a2a') { return handleA2aRpc(req, need(deps.a2a, 'a2a')); }`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('POST /api/a2a is reachable without a device session token (owns its own auth)', async () => { /* no Authorization → not a 401-from-session-guard; reaches the handler */ });
test('POST /api/a2a message/send returns a JSON-RPC response with a submitted task', async () => { /* enabled + allowlisted skill → result.status.state submitted */ });
test('POST /api/a2a 404s when AGENT_A2A_ENABLED is off', async () => { /* flag off → 404 */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/a2a/rpc.ts src/server/app.ts tests/server/a2a-rpc-route.test.ts`.

```bash
git add src/server/a2a/rpc.ts src/server/app.ts tests/server/a2a-rpc-route.test.ts
git commit -m "feat(a2a): POST /api/a2a JSON-RPC route (session-guard exception, A2A-Bearer-owned auth)"
```

*Model: Opus (the session-guard exception is security-sensitive — the route must be past the DEVICE guard yet still fronted by the perimeter, and must not accidentally accept a device token in place of the A2A Bearer, D5).*

