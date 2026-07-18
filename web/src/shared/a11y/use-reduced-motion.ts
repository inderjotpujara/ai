import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the OS/browser requests reduced motion. `tokens.css`'s
 * `@media (prefers-reduced-motion: reduce)` rule only zeroes CSS
 * animation/transition durations — it has no effect on JS-driven motion like
 * `@xyflow/react`'s imperative `fitView` pan/zoom (D3). Consumers that drive
 * their own animation read this hook instead.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof matchMedia === 'function'
      ? matchMedia(REDUCED_MOTION_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
