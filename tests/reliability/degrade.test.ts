import { describe, expect, it } from 'bun:test';
import type { ModelDeclaration } from '../../src/core/types.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { degradeChain, failureDomain } from '../../src/reliability/degrade.ts';

function decl(model: string, runtime: RuntimeKind): ModelDeclaration {
  return {
    role: 'general',
    model,
    runtime,
    requires: [],
  } as unknown as ModelDeclaration;
}

describe('failureDomain', () => {
  it('same runtime → same domain; different runtime → different domain', () => {
    expect(failureDomain(decl('a', RuntimeKind.Ollama))).toBe(
      failureDomain(decl('b', RuntimeKind.Ollama)),
    );
    expect(failureDomain(decl('a', RuntimeKind.Ollama))).not.toBe(
      failureDomain(decl('a', RuntimeKind.MlxServer)),
    );
  });
});

describe('degradeChain', () => {
  it('interleaves so consecutive entries avoid the same failure domain', () => {
    const chain = degradeChain([
      decl('o1', RuntimeKind.Ollama),
      decl('o2', RuntimeKind.Ollama),
      decl('m1', RuntimeKind.MlxServer),
    ]);
    // first is still the best (o1); second must switch domain (m1), not o2
    expect(chain[0]?.model).toBe('o1');
    if (chain[0] === undefined || chain[1] === undefined) {
      throw new Error('unexpected: chain should have at least 2 elements');
    }
    expect(failureDomain(chain[1])).not.toBe(failureDomain(chain[0]));
  });

  it('is a stable passthrough when all share one domain', () => {
    const input = [
      decl('o1', RuntimeKind.Ollama),
      decl('o2', RuntimeKind.Ollama),
    ];
    expect(degradeChain(input).map((d) => d.model)).toEqual(['o1', 'o2']);
  });
});
