# Task 4 — Central child-process registry — report

Status: DONE (controller-recovered after the implementer subagent was interrupted by an org spend-window limit; then review fixes applied).

## Shipped
- src/process/child-registry.ts — registerChild(handle):()=>void, killAllChildren(sig?:NodeJS.Signals), childCount(). Killable = { kill:(sig?:NodeJS.Signals)=>void } (narrowed from string so ChildHandle is assignable, no cast).
- tests/process/child-registry.test.ts — asserts kill-drains-live-only + unregister-removes; beforeEach(killAllChildren) isolates it from the process-global singleton (order-independent across suites).
- Wired register + unregister-on-exit into all four spawn sites: runtime/process-supervisor.ts (superviseServer), media/generate/adapter.ts (runOneShotJob), voice/cli-io.ts (mic), voice/transcribe.ts (defaultNodeSpawn).
- docs/architecture.md — Process subsystem row (per-commit docs:check requires new subsystems documented).

## Review fixes (Important x2)
1. Voice kill-closures forward the signal: kill:(sig)=>child.kill(sig ?? 'SIGTERM') (was hardcoded SIGTERM; would ignore a future killAllChildren('SIGKILL') escalation).
2. architecture.md Process row reworded to not reference lifecycle.ts (Task 5's file, not yet shipped).

## Verification
typecheck clean; lint clean on all touched files; bun test tests/process/ tests/voice/ tests/runtime/ tests/media/ -> 223 pass/0 fail (registry test passes alone and combined); docs:check green.

## Notes
Additive safety net; no spawn site's own kill/teardown removed. Lesson: each new-subsystem task must add its own architecture.md stub (per-commit docs:check gate).
