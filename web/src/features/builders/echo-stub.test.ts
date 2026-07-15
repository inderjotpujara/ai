import { describe, expect, it } from 'vitest';
import { echoBuilderStub } from './echo-stub.ts';

describe('echoBuilderStub', () => {
  it('yields an echo line then a stub-notice line', async () => {
    const lines: string[] = [];
    for await (const line of echoBuilderStub('fetch stock quotes')) {
      lines.push(line);
    }
    expect(lines).toEqual([
      'Received: "fetch stock quotes"',
      'Stub: real builder streaming lands in Increment 2.',
    ]);
  });
});
