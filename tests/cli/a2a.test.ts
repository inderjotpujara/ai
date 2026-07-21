import { afterEach, expect, test } from 'bun:test';
import type { SkillEntry } from '../../src/a2a/allowlist.ts';
import type { RemoteAgent } from '../../src/a2a/client.ts';
import type { IssuedToken } from '../../src/a2a/enroll.ts';
import { type A2aCliDeps, runA2aCli } from '../../src/cli/a2a.ts';
import { JobKind } from '../../src/queue/types.ts';

function makeSkill(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    skillId: 'skill-1',
    name: 'summarize',
    description: 'Summarize text',
    kind: JobKind.Chat,
    ref: 'summarizer',
    ...overrides,
  };
}

function makeRemote(overrides: Partial<RemoteAgent> = {}): RemoteAgent {
  return {
    name: 'peer-1',
    baseUrl: 'https://peer.example/api/a2a',
    cardUrl: 'https://peer.example/.well-known/agent-card.json',
    token: 'peer-bearer-secret',
    pinnedCardHash: 'sha256-abc123',
    ...overrides,
  };
}

function harness() {
  const out: string[] = [];
  const calls: { fn: string; args: unknown[] }[] = [];
  const state = {
    skills: [makeSkill()] as SkillEntry[],
    tokens: [{ id: 'tok-1', label: 'ci', createdAt: 1 }] as IssuedToken[],
    remotes: [makeRemote()] as RemoteAgent[],
  };
  const deps: A2aCliDeps = {
    skills: {
      list: () => {
        calls.push({ fn: 'skills.list', args: [] });
        return state.skills;
      },
      put: (e) => {
        calls.push({ fn: 'skills.put', args: [e] });
      },
      remove: (id) => {
        calls.push({ fn: 'skills.remove', args: [id] });
      },
    },
    token: {
      issue: (label) => {
        calls.push({ fn: 'token.issue', args: [label] });
        return { id: 'tok-2', token: 'raw-secret-once' };
      },
      revoke: (id) => {
        calls.push({ fn: 'token.revoke', args: [id] });
      },
      list: () => {
        calls.push({ fn: 'token.list', args: [] });
        return state.tokens;
      },
    },
    remotes: {
      list: () => {
        calls.push({ fn: 'remotes.list', args: [] });
        return state.remotes;
      },
      add: async (cardUrl, token) => {
        calls.push({ fn: 'remotes.add', args: [cardUrl, token] });
        return makeRemote({ name: 'peer-2', cardUrl, token });
      },
      remove: (name) => {
        calls.push({ fn: 'remotes.remove', args: [name] });
      },
    },
    call: async (name, task) => {
      calls.push({ fn: 'call', args: [name, task] });
      if (name === 'boom') throw new Error('remote task timed out');
      return `reply from ${name}: ${task}`;
    },
    card: () => {
      calls.push({ fn: 'card', args: [] });
      return { name: 'local-agent', skills: [] };
    },
    print: (s) => out.push(s),
  };
  return { deps, out, calls, state };
}

// `call`'s failure path sets `process.exitCode = 1` (mirrors the
// agent-builder/crew-builder/triggers CLI idiom) — reset it after every test
// so a rejection assertion never leaks a non-zero exit code into the rest of
// the `bun test` run.
afterEach(() => {
  process.exitCode = 0;
});

test('token issue prints the secret exactly once', async () => {
  const h = harness();
  await runA2aCli(['token', 'issue', 'my-label'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'token.issue', args: ['my-label'] });
  const printed = h.out.join('\n');
  const occurrences = printed.split('raw-secret-once').length - 1;
  expect(occurrences).toBe(1);
  expect(printed).toContain('shown once');
});

test('skills list prints rows', async () => {
  const h = harness();
  await runA2aCli(['skills', 'list'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'skills.list', args: [] });
  const printed = h.out.join('\n');
  expect(printed).toContain('skill-1');
  expect(printed).toContain('summarize');
});

test('skills list with none prints a friendly message', async () => {
  const h = harness();
  h.state.skills = [];
  await runA2aCli(['skills', 'list'], h.deps);
  expect(h.out.join('\n')).toContain('no skills');
});

test('skills add parses JSON and calls deps.skills.put', async () => {
  const h = harness();
  const entry = makeSkill({ skillId: 'skill-2' });
  await runA2aCli(['skills', 'add', JSON.stringify(entry)], h.deps);
  expect(h.calls).toContainEqual({ fn: 'skills.put', args: [entry] });
  expect(h.out.join('\n')).toContain('skill-2');
});

test('skills add with invalid JSON prints an error and does not call put', async () => {
  const h = harness();
  await runA2aCli(['skills', 'add', '{not json'], h.deps);
  expect(h.calls.some((c) => c.fn === 'skills.put')).toBe(false);
  expect(h.out.join('\n')).toMatch(/invalid JSON/i);
});

test('skills remove calls deps.skills.remove with the id', async () => {
  const h = harness();
  await runA2aCli(['skills', 'remove', 'skill-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'skills.remove', args: ['skill-1'] });
});

test('token revoke calls deps.token.revoke with the id', async () => {
  const h = harness();
  await runA2aCli(['token', 'revoke', 'tok-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'token.revoke', args: ['tok-1'] });
});

test('token list prints rows without ever printing a secret', async () => {
  const h = harness();
  await runA2aCli(['token', 'list'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'token.list', args: [] });
  const printed = h.out.join('\n');
  expect(printed).toContain('tok-1');
  expect(printed).toContain('ci');
});

test('remotes list prints rows', async () => {
  const h = harness();
  await runA2aCli(['remotes', 'list'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'remotes.list', args: [] });
  expect(h.out.join('\n')).toContain('peer-1');
});

test('remotes add calls deps.remotes.add and prints the pinned hash', async () => {
  const h = harness();
  await runA2aCli(
    ['remotes', 'add', 'https://peer.example/card.json', 'peer-token'],
    h.deps,
  );
  expect(h.calls).toContainEqual({
    fn: 'remotes.add',
    args: ['https://peer.example/card.json', 'peer-token'],
  });
  const printed = h.out.join('\n');
  expect(printed).toContain('peer-2');
  expect(printed).toContain('sha256-abc123');
});

test('remotes remove calls deps.remotes.remove with the name', async () => {
  const h = harness();
  await runA2aCli(['remotes', 'remove', 'peer-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'remotes.remove', args: ['peer-1'] });
});

test('call invokes deps.call and prints the result', async () => {
  const h = harness();
  await runA2aCli(['call', 'peer-1', 'summarize this'], h.deps);
  expect(h.calls).toContainEqual({
    fn: 'call',
    args: ['peer-1', 'summarize this'],
  });
  expect(h.out.join('\n')).toContain('reply from peer-1: summarize this');
});

test('call surfaces a rejected promise as a printed error, non-zero exit', async () => {
  const h = harness();
  await runA2aCli(['call', 'boom', 'task'], h.deps);
  expect(h.out.join('\n')).toMatch(/remote task timed out/);
  expect(process.exitCode).toBe(1);
});

test('card prints the local agent card as JSON', async () => {
  const h = harness();
  await runA2aCli(['card'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'card', args: [] });
  expect(h.out.join('\n')).toContain('local-agent');
});

test('unknown top-level command prints usage', async () => {
  const h = harness();
  await runA2aCli(['bogus'], h.deps);
  expect(h.out.join('\n')).toMatch(/usage: agent a2a/);
});
