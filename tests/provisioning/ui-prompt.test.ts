import { describe, expect, it } from 'bun:test';
import { askYesNo, selectModels } from '../../src/provisioning/ui/prompt.ts';

function fakeInput(lines: string[]) {
  let i = 0;
  return { read: async () => lines[i++] ?? '' };
}

describe('askYesNo', () => {
  it('returns true on "y"', async () => {
    expect(
      await askYesNo('ok?', { input: fakeInput(['y']), autoYes: false }),
    ).toBe(true);
  });
  it('returns false on "n"', async () => {
    expect(
      await askYesNo('ok?', { input: fakeInput(['n']), autoYes: false }),
    ).toBe(false);
  });
  it('short-circuits to true when autoYes is set (no read)', async () => {
    expect(await askYesNo('ok?', { input: fakeInput([]), autoYes: true })).toBe(
      true,
    );
  });
});

describe('selectModels', () => {
  it('keeps the recommended pre-selection on empty (Enter) input', async () => {
    const items = [
      { id: 'a', recommended: true },
      { id: 'b', recommended: false },
    ];
    const out = await selectModels(items, {
      input: fakeInput(['']),
      autoYes: false,
      label: (x) => x.id,
    });
    expect(out.map((x) => x.id)).toEqual(['a']);
  });
  it('honors an explicit index selection "1,2"', async () => {
    const items = [
      { id: 'a', recommended: true },
      { id: 'b', recommended: false },
    ];
    const out = await selectModels(items, {
      input: fakeInput(['1,2']),
      autoYes: false,
      label: (x) => x.id,
    });
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('auto-yes selects the recommended set without reading', async () => {
    const items = [
      { id: 'a', recommended: true },
      { id: 'b', recommended: false },
    ];
    const out = await selectModels(items, {
      input: fakeInput([]),
      autoYes: true,
      label: (x) => x.id,
    });
    expect(out.map((x) => x.id)).toEqual(['a']);
  });
});
