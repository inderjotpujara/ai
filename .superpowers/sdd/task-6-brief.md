### Task 6: Serve `GET /.well-known/agent-card.json` (fail-safe + ETag)

**Files:**
- Create: `src/server/a2a/card.ts`
- Modify: `src/server/app.ts` (a branch in `buildFetch`, after `enforcePerimeter`, before the `/api` guard — beside the `/hooks/:token` branch at `app.ts:254`)
- Test: `tests/server/a2a-card-route.test.ts`

**Interfaces:**
- Consumes: `buildAgentCard`, `cardEtag` (Task 5); `deps.a2a` (a new optional `ServerDeps.a2a` field — `{ allowlist, enrollment?, ... }`, added here as `{ allowlist: A2aAllowlist }` and grown in later tasks); `deps.publicBaseUrl`; `loadConfig` for `AGENT_A2A_ENABLED` + `AGENT_A2A_CARD_TTL`; `recordA2aCard` (Task 2).
- Produces:
  - `src/server/a2a/card.ts`: `handleAgentCard(req: Request, deps: { allowlist: A2aAllowlist; publicBaseUrl: string }): Response` — **404 when `AGENT_A2A_ENABLED` is off** (fail-safe: discovery reveals nothing until exposed); else build the card, compute the ETag, honor `If-None-Match` (→ `304`), return `200` with `content-type: application/json`, `ETag`, and `Cache-Control: public, max-age=<AGENT_A2A_CARD_TTL>`. `recordA2aCard({ cacheHit })`.
  - `app.ts` branch (in `buildFetch`, method GET, path `=== '/.well-known/agent-card.json'`): `if (!deps.a2a) return json({ error: 'a2a unavailable' }, 503); return handleAgentCard(req, { allowlist: deps.a2a.allowlist, publicBaseUrl: need(deps.publicBaseUrl, 'publicBaseUrl') });`. Placed OUTSIDE the `/api` session guard (public discovery) but INSIDE the Host/Origin perimeter (already enforced above).

- [ ] **Step 1: Write the failing tests:**

```ts
test('card route 404s when AGENT_A2A_ENABLED is off (fail-safe)', async () => { /* build fetch with a2a wired, flag off → GET /.well-known/agent-card.json → 404 */ });
test('card route serves the card + ETag when enabled, no bearer required', async () => { /* flag on → 200 + ETag + Cache-Control, reachable with NO Authorization header */ });
test('If-None-Match matching the ETag returns 304', async () => { /* second GET with the ETag → 304 */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block. Add the optional `a2a?: { allowlist: A2aAllowlist }` field to `ServerDeps` (`src/server/app.ts:89`) — grown in Increments 3/5/6.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/a2a/card.ts src/server/app.ts tests/server/a2a-card-route.test.ts`.

```bash
git add src/server/a2a/card.ts src/server/app.ts tests/server/a2a-card-route.test.ts
git commit -m "feat(a2a): GET /.well-known/agent-card.json (public discovery, 404 when disabled, ETag)"
```

*Model: Opus (route placement is security-sensitive — the card must be outside the session guard yet inside the perimeter, and MUST 404 when the flag is off; a card leaked while disabled advertises internal capability).*

