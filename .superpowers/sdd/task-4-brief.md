### Task 4: Contract inbound request schemas + barrel

**Files:**
- Create: `src/contracts/requests.ts`, `src/contracts/index.ts`
- Test: `tests/contracts/requests.test.ts`

**Interfaces:**
- Consumes: `ChatRole` from `./enums.ts`.
- Produces: `UiMessagePartSchema`, `UiMessageLikeSchema`/`UiMessageLike`, `ChatRequestSchema`/`ChatRequest`, `RespondRequestSchema`/`RespondRequest`; barrel `src/contracts/index.ts` re-exporting `./enums.ts`, `./dto.ts`, `./events.ts`, `./requests.ts`.

- [ ] **Step 1: Write the failing inbound-request test**

```ts
// tests/contracts/requests.test.ts
import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import {
  ChatRequestSchema,
  RespondRequestSchema,
  UiMessageLikeSchema,
} from '../../src/contracts/requests.ts';

test('a minimal UIMessage-like body validates (no AI-SDK types)', () => {
  const parsed = UiMessageLikeSchema.parse({
    id: 'm1',
    role: ChatRole.User,
    parts: [{ type: 'text', text: 'hello' }],
  });
  expect(parsed.parts[0].text).toBe('hello');
});

test('ChatRequest validates a messages array + optional sessionId', () => {
  const parsed = ChatRequestSchema.parse({
    messages: [{ id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] }],
  });
  expect(parsed.messages.length).toBe(1);
  expect(parsed.sessionId).toBeUndefined();
});

test('ChatRequest rejects a malformed body (missing messages)', () => {
  expect(() => ChatRequestSchema.parse({ foo: 1 })).toThrow();
});

test('RespondRequest requires a promptId and accepts an opaque value', () => {
  const parsed = RespondRequestSchema.parse({ promptId: 'cap-x', value: { ok: true } });
  expect(parsed.promptId).toBe('cap-x');
  expect(() => RespondRequestSchema.parse({ value: 1 })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/requests.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/requests.ts`.

- [ ] **Step 3: Write the request schemas + barrel**

```ts
// src/contracts/requests.ts
import { z } from 'zod';
import { ChatRole } from './enums.ts';

/**
 * A minimal, structural UIMessage-like shape. We deliberately do NOT import
 * AI-SDK's UIMessage type (Slice 23 forward-compat). The Phase-2 chat handler
 * `await convertToModelMessages(...)` (async in AI SDK v6.0.217) on the parsed
 * value; Phase 1 only validates the wire body before any engine call.
 */
export const UiMessagePartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

export const UiMessageLikeSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  parts: z.array(UiMessagePartSchema),
});
export type UiMessageLike = z.infer<typeof UiMessageLikeSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(UiMessageLikeSchema),
  sessionId: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const RespondRequestSchema = z.object({
  promptId: z.string(),
  value: z.unknown(),
});
export type RespondRequest = z.infer<typeof RespondRequestSchema>;
```

```ts
// src/contracts/index.ts
export * from './enums.ts';
export * from './dto.ts';
export * from './events.ts';
export * from './requests.ts';
```

- [ ] **Step 4: Run request test to verify it passes**

Run: `bun test tests/contracts/requests.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm the isomorphic guard still passes over all 5 contract files**

Run: `bun test tests/contracts/isomorphic.test.ts`
Expected: PASS — every file imports only `zod` / `./` siblings.

- [ ] **Step 6: Commit**

```bash
git add src/contracts/requests.ts src/contracts/index.ts tests/contracts/requests.test.ts
git commit -m "feat(contracts): add inbound request schemas + barrel export"
```

---

