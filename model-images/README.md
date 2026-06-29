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

**Start Ollama via the project script on every machine** — this is the uniform
process, and it points Ollama's storage here automatically:

```sh
bun run serve     # = scripts/serve.sh → `ollama serve` with OLLAMA_MODELS=<repo>/model-images
```

(Quit the Ollama menu-bar app first, or it will hold port 11434 and use the
wrong storage dir — `scripts/serve.sh` checks for this and warns you.)

Then `ollama pull qwen3.5:9b` (or let the framework's autonomous pull handle it)
writes the blobs here. Because storage is set by the **server** process (not our CLI),
starting Ollama this way is what guarantees models land in `model-images/`
identically on the laptop and the Mac Mini.

> Heavy files here are intentionally ignored by git (see the repo `.gitignore`).
> Each machine keeps its own local copy; nothing here is committed.
