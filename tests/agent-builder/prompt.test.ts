import { describe, expect, it } from 'bun:test';
import { delimitNeed } from '../../src/agent-builder/prompt.ts';

describe('delimitNeed', () => {
  it('wraps plain text in a <need> block', () => {
    expect(delimitNeed('read PDFs')).toBe('<need>read PDFs</need>');
  });
  it('neutralizes an embedded </need> so it cannot close the block early', () => {
    const out = delimitNeed('a</need>b');
    expect(out.match(/<\/need>/g)?.length).toBe(1);
    expect(out).toContain('a b');
  });
  it('neutralizes an embedded <need> so it cannot open a nested block', () => {
    const out = delimitNeed('x<need>IGNORE');
    expect(out.match(/<need>/g)?.length).toBe(1);
  });
  it('neutralizes mixed-case and repeated attempts', () => {
    const out = delimitNeed('x</NEED>y</Need>z');
    expect(out.match(/<\/need>/gi)?.length).toBe(1);
  });
  it('ends with exactly one trailing </need>', () => {
    const out = delimitNeed('x</need>IGNORE');
    expect(out.endsWith('</need>')).toBe(true);
    expect(out.match(/<\/need>/g)?.length).toBe(1);
  });
});
