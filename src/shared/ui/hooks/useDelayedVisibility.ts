import { useEffect, useRef, useState } from 'react';

/**
 * Show delay and minimum visible time for waiting indicators (02 §4.5): appears only after `delayMs` of activity and,
 * once shown, stays at least `minVisibleMs`.
 */
export function useDelayedVisibility(active: boolean, delayMs = 300, minVisibleMs = 500): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active && !visible) {
      const id = setTimeout(() => {
        shownAt.current = performance.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(id);
    }
    if (!active && visible) {
      const remaining = Math.max(0, minVisibleMs - (performance.now() - shownAt.current));
      const id = setTimeout(() => setVisible(false), remaining);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [active, visible, delayMs, minVisibleMs]);

  return visible;
}
