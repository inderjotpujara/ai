### Task 18 report: MCP `MCP_TRANSPORT` attr emission

**Status:** Done.

**Problem:** `ATTR.MCP_TRANSPORT` (`mcp.transport`) was defined in `src/telemetry/spans.ts` but never set on any span or event (flagged in the Slice-15 review as dead telemetry).

**Root cause / where transport is known:** `mountAll` in `src/mcp/mount.ts` iterates `config.entries: McpServerEntry[]`, and each entry already carries `kind: McpTransportKind` (`Stdio` | `Http`, from `src/mcp/types.ts`, set by `toEntry()` in `src/mcp/config.ts` based on whether the raw mcp.json entry has a `command` or a `url`). That's the one place transport kind is unambiguously known per server.

**Implementation:**
1. `src/mcp/mount.ts` — `MountedRegistry.mounted` now carries `kind: McpTransportKind` alongside `name`/`toolCount`; the `mounted.push(...)` call in the mount loop sets it from `entry.kind`. `skipped`/`dormant` shapes are untouched (skipped can fail before a transport-relevant attempt in some paths, and dormant entries don't retain `kind` in `McpConfig.dormant` — kept minimal/honest rather than fabricating a value).
2. `src/telemetry/spans.ts` — `withMcpMountSpan`'s `record` callback gained an optional 4th parameter `transport?: string`. When supplied, the `mcp.server.mount` event now includes `[ATTR.MCP_TRANSPORT]: transport`; when omitted (skipped/dormant calls), the attribute is simply not set — same optional-attribute pattern already used for `toolCount`. No new dependency from `telemetry` on `mcp/types.ts`: the param stays a plain `string`, keeping telemetry decoupled from the MCP domain type.
3. `src/cli/with-mcp-run.ts` — the `mounted` loop now passes `m.kind` through: `record(m.name, 'mounted', m.toolCount, m.kind)`. `skipped`/`dormant` calls unchanged (no transport recorded there, honest to what's known/relevant).

Values recorded are exactly the existing `McpTransportKind` enum values (`'stdio'` | `'http'`) — no new naming invented.

**Tests (TDD, focused):**
- `tests/mcp/tool-span-emission.test.ts` — two new cases on `withMcpMountSpan`: (a) `record(name, 'mounted', toolCount, transport)` for a stdio server and an http server produces two `mcp.server.mount` events each carrying the correct `ATTR.MCP_TRANSPORT`; (b) calling `record` without a transport arg (e.g. skipped/consent-denied path) leaves `ATTR.MCP_TRANSPORT` unset on that event (degrade-honest, not fabricated).
- `tests/mcp/mount-all.test.ts` — new case: `mountAll` over one stdio + one http entry tags `reg.mounted[i].kind` with `McpTransportKind.Stdio` / `.Http` respectively.
- `tests/cli/with-mcp-run.test.ts` — new integration case: a real `withMcpRun` pass over a stdio `ONE_SERVER_CONFIG` writes `mcp.mount`'s `mcp.server.mount` event to `spans.jsonl` with `attributes['mcp.transport'] === 'stdio'`, proving the attribute survives the full mount → span → JSONL-exporter path, not just the unit-level plumbing.

**RED→GREEN verified:** stashed the three implementation files (`spans.ts`, `mount.ts`, `with-mcp-run.ts`) and reran the three test files — all 3 new assertions failed with `undefined` where `'stdio'`/`'http'` was expected (14 pass / 3 fail). Restored the implementation — 17 pass / 0 fail.

**Verify (inline only, no full suite run per instructions):**
- `bun run typecheck` → clean (0 errors), both before and after the stash round-trip.
- `bun run lint:file -- src/telemetry/spans.ts src/mcp/mount.ts src/cli/with-mcp-run.ts tests/mcp/tool-span-emission.test.ts tests/mcp/mount-all.test.ts tests/cli/with-mcp-run.test.ts` → clean after one `--write` pass (2 formatting-only fixes: a line-wrap in `with-mcp-run.ts` and an `expect(...)` chain wrap in `mount-all.test.ts`).
- `bun run test:file -- "tests/mcp/tool-span-emission.test.ts" "tests/mcp/mount-all.test.ts" "tests/cli/with-mcp-run.test.ts"` → 17 pass / 0 fail / 36 expect() calls.

**Concerns / follow-ups (none blocking):**
- `skipped` and `dormant` mount outcomes don't carry `MCP_TRANSPORT` — `dormant` genuinely can't (transport isn't retained in `McpConfig.dormant`), and `skipped` was left alone to avoid widening the diff and to keep the existing exact-equality test in `mount-all.test.ts` (`expect(reg.skipped).toEqual([{ name: 'boom', reason: 'spawn failed' }])`) passing unchanged. If a future slice wants transport on skipped/dormant too, that's a small additive change (thread `kind` through `skipped.push`/`config.dormant` the same way) but is out of scope for "emit the dead attr on the mount span."
- No new deps; no hardcoded values — transport values are the pre-existing `McpTransportKind` enum members.

**Commit:** `feat(telemetry): emit MCP_TRANSPORT on mcp mount spans`
