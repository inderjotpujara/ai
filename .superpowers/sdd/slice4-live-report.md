# Slice 4 Live Verification Report
Date: 2026-06-29  
Machine: Apple M4 Pro, 24 GB (25.77 GB reported), macOS Darwin 25.5.0  
Ollama version: 0.30.8

---

## Step 1 — Server Start

- Killed menu-bar Ollama app + pkill for any standalone serve.
- Port 11434 was free.
- Started `nohup bash scripts/serve.sh > /tmp/s4-serve.log 2>&1 &`
- Server came up in <1s.
- Log confirmed: `OLLAMA_MODELS=/Users/inderjotsingh/ai/model-images`

---

## Step 2 — Model Tag Existence + Tool-Calling

**qwen3.5:4b:**
- `ollama pull qwen3.5:4b` → SUCCESS (3.4 GB, Q4_K_M)
- `ollama show qwen3.5:4b` Capabilities: `completion, vision, tools, thinking`
- **tools: YES**

**qwen3.5:9b:**
- `ollama pull qwen3.5:9b` → SUCCESS (6.6 GB, Q4_K_M)
- `ollama show qwen3.5:9b` Capabilities: `completion, vision, tools, thinking`
- **tools: YES**

**Both qwen3.5 tags exist on Ollama and support tool-calling. No fallback needed.**

---

## Step 3 — Fallback

**NOT executed.** Both qwen3.5 tags exist and support `tools`.

---

## Step 4 — Live Tests

### model-manager.live.test.ts
- **RAN** (not skipped — both models present)
- **FAIL: 0 pass, 1 fail**
- Root cause: `serve.sh` starts Ollama with default `OLLAMA_MAX_LOADED_MODELS:0` (auto), which in practice serializes to 1 model at a time. When `warmModel(qwen3.5:9b)` is called, Ollama evicts `qwen3.5:4b` from VRAM before returning. The model-manager budget logic correctly determines both models fit (~3.22 GB + 5.65 GB = 8.87 GB << 19.33 GB budget), so our unload loop never fires — but Ollama itself auto-evicts during the warm. Result: after both `ensureReady` calls, only `qwen3.5:9b` is resident; the pinned router assertion fails.
- Fix needed (NOT applied per task constraints): add `OLLAMA_MAX_LOADED_MODELS=2` to `serve.sh`.

### orchestrator.live.test.ts
- **RAN** (not skipped — qwen3.5:9b present)
- **PASS: 2 pass, 0 fail**
  - `delegates a file question to file-qa and answers` ✓
  - `reports a capability gap for an out-of-scope request` ✓

### orchestrator-web.live.test.ts
- **RAN** (not skipped — uvx available + qwen3.5:9b present)
- **PASS: 1 pass, 0 fail**
  - `routes a URL request to web_fetch and answers` ✓

**Overall: 3 pass, 1 fail across 3 test files**

---

## Step 5 — CLI Smoke Test

```
$ echo "The quick brown fox jumps over the lazy dog." > /tmp/s4.txt
$ bun run src/cli/chat.ts "What animal is in /tmp/s4.txt?"

Preparing router model qwen3.5:4b...
Using project-local models from ./model-images
The animal in `/tmp/s4.txt` is a **fox**.
```

**PASS** — router loaded, routed to file_qa specialist, read the file, returned correct answer.

---

## Step 6 — Cleanup

- `pkill -f "ollama serve"`
- Confirmed: 0 processes on :11434

---

## Summary

| Item | Result |
|------|--------|
| qwen3.5:4b on Ollama? | YES — 3.4 GB, tools: YES |
| qwen3.5:9b on Ollama? | YES — 6.6 GB, tools: YES |
| Fallback to qwen3:4b/8b? | NO |
| Fallback commit? | N/A |
| model-manager.live.test.ts | FAIL (1 test — co-residency broken: serve.sh needs OLLAMA_MAX_LOADED_MODELS=2) |
| orchestrator.live.test.ts | PASS (2/2) |
| orchestrator-web.live.test.ts | PASS (1/1) |
| CLI smoke test | PASS — "The animal in /tmp/s4.txt is a **fox**." |
| Port :11434 at end | FREE |
