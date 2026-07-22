### Task 1: A2A wire contracts + parity test

**Files:**
- Create: `src/contracts/a2a.ts`
- Modify: `src/contracts/index.ts` (already `export *`; add `export * from './a2a.ts';`)
- Test: `tests/contracts/a2a-contracts.test.ts`

**Interfaces:**
- Consumes: `z` from `zod` only. (Contracts stay isomorphic — import only `zod` + other contracts/enums. **`JobKindWire` is deliberately NOT imported here**: no Task-1 schema uses it, so importing it would trip biome `noUnusedImports` and fail Task 1's `lint:file` gate. It is introduced in Task 17, the first task with a `JobKindWire`-typed wire schema — see the `A2aSkillEntryWireSchema` note there.)
- Produces (all exported from `src/contracts/a2a.ts`):
  - `enum TaskStateWire { Submitted='submitted', Working='working', Completed='completed', Failed='failed', Canceled='canceled', Rejected='rejected', InputRequired='input-required', AuthRequired='auth-required' }` — lowercase-hyphenated, the JSON-RPC casing.
  - `enum A2aMethod { MessageSend='message/send', MessageStream='message/stream', TasksGet='tasks/get', TasksCancel='tasks/cancel', TasksResubscribe='tasks/resubscribe' }`.
  - `PartSchema` — discriminated union on `kind`: `{ kind: z.literal('text'), text: z.string() }` | `{ kind: z.literal('file'), file: z.object({ name: z.string().optional(), mimeType: z.string().optional(), bytes: z.string() }) }` | `{ kind: z.literal('data'), data: z.record(z.string(), z.unknown()) }`.
  - `MessageSchema` / `A2aMessage`: `{ role: z.enum(['user','agent']), parts: z.array(PartSchema), messageId: z.string(), contextId: z.string().optional(), taskId: z.string().optional() }`.
  - `ArtifactSchema` / `A2aArtifact`: `{ artifactId: z.string(), name: z.string().optional(), parts: z.array(PartSchema) }`.
  - `TaskStatusSchema`: `{ state: z.enum(TaskStateWire), message: MessageSchema.optional(), timestamp: z.string().optional() }`.
  - `TaskSchema` / `A2aTask`: `{ id: z.string(), contextId: z.string(), status: TaskStatusSchema, artifacts: z.array(ArtifactSchema).default([]), history: z.array(MessageSchema).default([]), kind: z.literal('task') }`.
  - `AgentSkillSchema`: `{ id: z.string(), name: z.string(), description: z.string(), tags: z.array(z.string()).default([]), inputModes: z.array(z.string()).optional(), outputModes: z.array(z.string()).optional() }`.
  - `AgentCardSchema` / `A2aAgentCard`: `{ name, description, version, protocolVersion: z.literal('1.0'), url: z.string(), preferredTransport: z.string().default('JSONRPC'), skills: z.array(AgentSkillSchema), capabilities: z.object({ streaming: z.boolean(), pushNotifications: z.boolean() }), defaultInputModes: z.array(z.string()), defaultOutputModes: z.array(z.string()), securitySchemes: z.record(z.string(), z.unknown()), security: z.array(z.record(z.string(), z.array(z.string()))).default([]) }`.
  - JSON-RPC envelopes: `JsonRpcRequestSchema` (`{ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).nullable(), method: z.string(), params: z.unknown().optional() }`), `JsonRpcErrorSchema` (`{ code: z.number(), message: z.string(), data: z.unknown().optional() }`), `JsonRpcResponseSchema` (`{ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).nullable(), result: z.unknown().optional(), error: JsonRpcErrorSchema.optional() }`).

- [ ] **Step 1: Write the failing test** — `TaskStateWire` values, `Part` union round-trip, and a `protocolVersion !== "1.0"` reject:

```ts
import { expect, test } from 'bun:test';
import {
  AgentCardSchema,
  PartSchema,
  TaskStateWire,
} from '../../src/contracts/a2a.ts';

test('TaskStateWire holds the eight A2A v1.0 wire states', () => {
  expect(Object.values(TaskStateWire).sort()).toEqual(
    [
      'auth-required',
      'canceled',
      'completed',
      'failed',
      'input-required',
      'rejected',
      'submitted',
      'working',
    ],
  );
});

test('PartSchema round-trips a text part and rejects an unknown kind', () => {
  expect(PartSchema.parse({ kind: 'text', text: 'hi' })).toMatchObject({
    kind: 'text',
  });
  expect(() => PartSchema.parse({ kind: 'audio', text: 'x' })).toThrow();
});

test('AgentCardSchema rejects a non-1.0 protocolVersion', () => {
  const base = {
    name: 'n', description: 'd', version: '1', protocolVersion: '0.3',
    url: 'https://h/api/a2a', skills: [],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    securitySchemes: {}, security: [],
  };
  expect(() => AgentCardSchema.parse(base)).toThrow();
  expect(AgentCardSchema.parse({ ...base, protocolVersion: '1.0' })).toMatchObject({
    protocolVersion: '1.0',
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "TaskStateWire holds"` → FAIL (module not found).
- [ ] **Step 3: Write minimal implementation** — create `src/contracts/a2a.ts` with the enums + schemas from the Produces block; add `export * from './a2a.ts';` to `src/contracts/index.ts`. Import only `zod` + `JobKindWire` (isomorphic — no engine imports).
- [ ] **Step 4: Run test to verify it passes** — `bun run test -- -t "TaskStateWire holds"` → PASS (all three).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/contracts/a2a.ts src/contracts/index.ts tests/contracts/a2a-contracts.test.ts`.

```bash
git add src/contracts/a2a.ts src/contracts/index.ts tests/contracts/a2a-contracts.test.ts
git commit -m "feat(contracts): A2A v1.0 wire contracts (card/message/task/part + JSON-RPC + TaskStateWire)"
```

*Model: Sonnet (mechanical schema definition mirroring the `dto.ts`/`enums.ts` convention).*

