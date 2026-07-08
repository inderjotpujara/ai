/** Collision-free, chronologically-sortable run id: run-<base36 ms>-<base36 rand>. */
export function newRunId(now: number = Date.now(), rand: () => number = Math.random): string {
  const ms = Math.floor(now).toString(36).padStart(9, '0');
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
  return `run-${ms}-${r}`;
}
