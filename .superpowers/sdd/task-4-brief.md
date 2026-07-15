### Task 4: `readRunArtifacts` — readdir + classify into `ArtifactKind`

**Files:**
- Create: `src/run/artifacts.ts`
- Test: `tests/run/artifacts.test.ts`

**Interfaces:**
- Consumes: `ArtifactKind` from `../contracts/index.ts`; `node:fs/promises` (`readdir`, `stat`), `node:path`.
- Produces: `readRunArtifacts(runDir: string): Promise<{ name: string; bytes: number; kind: ArtifactKind }[]>` — `readdir` the run dir; classify each entry by filename via a table (unknown files → `Other`); `bytes` = `stat().size` for files, and for the `media/` **directory** the rolled-up sum of contained file sizes. A missing run dir → `[]` (never throws).

Classification table (from spec):

| entry | `ArtifactKind` |
|---|---|
| `answer.txt` | `Answer` |
| `gap.txt` | `Gap` |
| `resource.txt` | `Resource` |
| `result.txt` | `Result` |
| `unverified.txt` | `Unverified` |
| `failed.txt` | `Failed` |
| `spans.jsonl` | `Spans` |
| `degradation.jsonl` | `Degradation` |
| `error.json` | `Error` |
| `media/` (dir) | `Media` |
| anything else | `Other` |

- [ ] **Step 1: Write the failing test** — `tests/run/artifacts.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactKind } from '../../src/contracts/enums.ts';
import { readRunArtifacts } from '../../src/run/artifacts.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'art-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('classifies known files and falls unknown files through to Other', async () => {
  await writeFile(join(dir, 'answer.txt'), 'hello');
  await writeFile(join(dir, 'result.txt'), 'r');
  await writeFile(join(dir, 'spans.jsonl'), '{}\n');
  await writeFile(join(dir, 'degradation.jsonl'), '{}\n');
  await writeFile(join(dir, 'error.json'), '{}');
  await writeFile(join(dir, 'random.log'), 'x');
  const arts = await readRunArtifacts(dir);
  const byName = new Map(arts.map((a) => [a.name, a]));
  expect(byName.get('answer.txt')?.kind).toBe(ArtifactKind.Answer);
  expect(byName.get('result.txt')?.kind).toBe(ArtifactKind.Result);
  expect(byName.get('spans.jsonl')?.kind).toBe(ArtifactKind.Spans);
  expect(byName.get('degradation.jsonl')?.kind).toBe(ArtifactKind.Degradation);
  expect(byName.get('error.json')?.kind).toBe(ArtifactKind.Error);
  expect(byName.get('random.log')?.kind).toBe(ArtifactKind.Other);
  expect(byName.get('answer.txt')?.bytes).toBe(5);
});

test('classifies the media/ directory as Media with a rolled-up byte size', async () => {
  await mkdir(join(dir, 'media'), { recursive: true });
  await writeFile(join(dir, 'media', 'a.png'), '1234');
  await writeFile(join(dir, 'media', 'b.png'), '56');
  const arts = await readRunArtifacts(dir);
  const media = arts.find((a) => a.name === 'media');
  expect(media?.kind).toBe(ArtifactKind.Media);
  expect(media?.bytes).toBe(6);
});

test('returns [] for a missing run dir (never throws)', async () => {
  expect(await readRunArtifacts(join(dir, 'nope'))).toEqual([]);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/run/artifacts.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/run/artifacts.ts`:

```ts
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactKind } from '../contracts/index.ts';

const FILE_KINDS: Record<string, ArtifactKind> = {
  'answer.txt': ArtifactKind.Answer,
  'gap.txt': ArtifactKind.Gap,
  'resource.txt': ArtifactKind.Resource,
  'result.txt': ArtifactKind.Result,
  'unverified.txt': ArtifactKind.Unverified,
  'failed.txt': ArtifactKind.Failed,
  'spans.jsonl': ArtifactKind.Spans,
  'degradation.jsonl': ArtifactKind.Degradation,
  'error.json': ArtifactKind.Error,
};

/** Sum of file sizes directly under `dir` (one level; media dirs are flat). */
async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    total += (await stat(join(dir, entry.name))).size;
  }
  return total;
}

/** Readdir + classify one run dir's artifacts into the extended ArtifactKind.
 *  Missing dir → [] (the mapper tolerates a run with only spans.jsonl). */
export async function readRunArtifacts(
  runDir: string,
): Promise<{ name: string; bytes: number; kind: ArtifactKind }[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(runDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; bytes: number; kind: ArtifactKind }[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'media') {
        out.push({
          name: 'media',
          bytes: await dirBytes(join(runDir, 'media')),
          kind: ArtifactKind.Media,
        });
      }
      continue;
    }
    const kind = FILE_KINDS[entry.name] ?? ArtifactKind.Other;
    const bytes = (await stat(join(runDir, entry.name))).size;
    out.push({ name: entry.name, bytes, kind });
  }
  return out;
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/run/artifacts.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/run/artifacts.ts" "tests/run/artifacts.test.ts"
git add src/run/artifacts.ts tests/run/artifacts.test.ts
git commit -m "feat(run): readRunArtifacts — readdir+classify run dir into ArtifactKind"
```

---

