import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tab-list.ts';

describe('nextTabIndex (D2 — shared roving-tabindex helper)', () => {
  it('ArrowRight moves to the next index and wraps past the last', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
  });

  it('ArrowLeft moves to the previous index and wraps before the first', () => {
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('Home/End jump to the first/last index', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it('any other key returns undefined (not handled by the tab widget)', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeUndefined();
    expect(nextTabIndex('a', 0, 3)).toBeUndefined();
  });
});
