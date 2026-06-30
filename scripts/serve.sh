#!/usr/bin/env bash
#
# Start Ollama for THIS project, with model images stored in ./model-images.
#
# Run this on EVERY machine (laptop, Mac Mini, …) instead of the default Ollama
# app, so the process — and where models live — is identical everywhere.
# Model blobs are git-ignored, so each machine keeps its own copy; the framework
# pulls anything missing on first use.
#
# Usage:  bun run serve     (or: bash scripts/serve.sh)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export OLLAMA_MODELS="$REPO_ROOT/model-images"

# Another Ollama (e.g. the menu-bar app) already holding the port will make
# `ollama serve` fail with "address already in use" — and it would use the
# WRONG models dir. Tell the user to quit it first.
if curl -fsS --max-time 1 http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "An Ollama server is already running on :11434." >&2
  echo "Quit the Ollama app (menu-bar) first, then re-run 'bun run serve' so" >&2
  echo "models are stored under: $OLLAMA_MODELS" >&2
  exit 1
fi

echo "Starting Ollama — OLLAMA_MODELS=$OLLAMA_MODELS"
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE="${AGENT_KV_CACHE_TYPE:-q8_0}"
echo "KV cache: $OLLAMA_KV_CACHE_TYPE (flash-attention on; required on Apple Silicon)"
if [ "$OLLAMA_KV_CACHE_TYPE" = "q4_0" ]; then
  echo "⚠ q4_0 KV degrades long-context recall + tool-calling, and arch-risky models (small head_dim / MoE). Prefer q8_0 unless verified." >&2
fi
exec ollama serve
