### Task 10: CLI flag parsing (`--voice`, `--voice-in`)

**Files:**
- Modify: `src/cli/chat.ts` (`parseMediaArgs`, `IngestFlags` usage, `hasMediaFlags`)
- Modify: `src/media/ingest.ts` (`IngestFlags` type: add `voice: boolean`, `voiceIn: string[]`)
- Test: `tests/voice/chat-args.test.ts`

**Interfaces:**
- Consumes: existing `parseMediaArgs` (returns `{positional, flags}`), `IngestFlags` (Task refs `src/media/ingest.ts:9-14`).
- Produces: `parseMediaArgs` recognizes `--voice` (boolean) and `--voice-in <path>` (repeatable value); `hasMediaFlags` returns true when either is set.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/chat-args.test.ts
import { describe, expect, it } from 'bun:test';
import { parseMediaArgs } from '../../src/cli/chat.ts';

describe('parseMediaArgs voice flags', () => {
  it('parses --voice as a boolean', () => {
    const { positional, flags } = parseMediaArgs(['--voice']);
    expect(flags.voice).toBe(true);
    expect(positional).toEqual([]);
  });
  it('parses --voice-in as a repeatable path and keeps prompt positional', () => {
    const { positional, flags } = parseMediaArgs(['summarize', '--voice-in', 'a.wav']);
    expect(flags.voiceIn).toEqual(['a.wav']);
    expect(positional).toEqual(['summarize']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/chat-args.test.ts`
Expected: FAIL — `flags.voice` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/media/ingest.ts`, extend `IngestFlags`:
```ts
export type IngestFlags = {
  images: string[];
  audios: string[];
  videos: string[];
  paste: boolean;
  voice: boolean;
  voiceIn: string[];
};
```

In `src/cli/chat.ts` `parseMediaArgs`, initialize the new fields and handle the flags:
```ts
  const flags: IngestFlags = {
    images: [], audios: [], videos: [], paste: false,
    voice: false, voiceIn: [],
  };
  // ...inside the loop, before the `else if (arg === '--paste')` branch:
    } else if (arg === '--voice-in') {
      const value = argv[i + 1];
      i += 1;
      if (value !== undefined) flags.voiceIn.push(value);
    } else if (arg === '--voice') {
      flags.voice = true;
```

Extend `hasMediaFlags`:
```ts
  return (
    flags.images.length > 0 || flags.audios.length > 0 || flags.videos.length > 0 ||
    flags.paste || flags.voice || flags.voiceIn.length > 0
  );
```

Update the usage string (`chat.ts:170`) to mention `--voice` / `--voice-in <path>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/chat-args.test.ts`
Then: `bun run typecheck` (IngestFlags is constructed in tests/media too — update any fixtures that build a literal `IngestFlags`).
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/chat.ts src/media/ingest.ts tests/voice/chat-args.test.ts
git commit -m "feat(voice): --voice and --voice-in CLI flags"
```

---

