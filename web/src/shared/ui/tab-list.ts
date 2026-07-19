/**
 * Pure roving-tabindex helper (D2), shared between `LibraryArea` and
 * `BuildersArea` rather than duplicated. Given the pressed key, the
 * currently-active tab index, and the tab count, returns the new active
 * index — or `undefined` if the key isn't part of the tab widget pattern
 * (ArrowLeft/ArrowRight roving, Home/End jump-to-ends). Callers own moving
 * DOM focus to the returned index (this module has no DOM dependency).
 */
export function nextTabIndex(
  key: string,
  activeIndex: number,
  count: number,
): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (activeIndex + 1) % count;
    case 'ArrowLeft':
      return (activeIndex - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
