import { StatusEventType } from '@contracts';
import { describe, expect, it } from 'vitest';
import type { ChatTransport, RunStream } from './types.ts';

describe('transport port', () => {
  it('a stub adapter satisfies the ChatTransport contract (compile + shape)', () => {
    const stub: ChatTransport = {
      async *stream() {
        yield { type: StatusEventType.RunStart, eventId: '1', runId: 'r1' };
      },
      async respond() {
        /* back-channel — Phase 2 */
      },
    };
    expect(typeof stub.stream).toBe('function');
    expect(typeof stub.respond).toBe('function');
  });

  it('RunStream carries a resume cursor', () => {
    const rs: RunStream = { runId: 'r1', cursor: null };
    expect(rs.cursor).toBeNull();
  });
});
