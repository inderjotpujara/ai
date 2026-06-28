# model-images/

Local home for **model image / blob files** (GGUF weights, quantized model
files, etc.) that the agents run against on this machine.

## Why this folder exists

Models are multi-gigabyte binaries. We keep them **inside the project** (rather
than only in `~/.ollama`) so that, on the dedicated Mac Mini, all model state
lives in one place we control. The contents are **git-ignored** — only this
README and a `.gitkeep` are tracked, so the folder exists on every checkout
without ever committing the heavy files.

## Using it with Ollama

To make Ollama store its model blobs here instead of the default `~/.ollama`,
point it at this folder before starting the server:

```sh
export OLLAMA_MODELS="$(pwd)/model-images"
ollama serve
```

Then `ollama pull qwen3:8b` (or the framework's autonomous pull) writes the
blobs under `model-images/`. Leaving `OLLAMA_MODELS` unset is also fine — Ollama
falls back to `~/.ollama` and the framework still works.

> Heavy files here are intentionally ignored by git (see the repo `.gitignore`).
