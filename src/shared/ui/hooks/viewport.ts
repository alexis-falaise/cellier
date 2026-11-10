let probe: HTMLDivElement | null = null;

/** Reads the safe-area insets once per call through a fixed probe (no layout reads during gestures). */
export function readSafeArea(): { top: number; bottom: number } {
  if (typeof document === 'undefined') return { top: 0, bottom: 0 };
  if (!probe?.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: Number.parseFloat(cs.paddingTop) || 0, bottom: Number.parseFloat(cs.paddingBottom) || 0 };
}

export function viewportHeight(): number {
  return typeof window === 'undefined' ? 0 : window.innerHeight;
}

/** Height hidden by the software keyboard, from the visual viewport (01 §4.6). */
export function keyboardInset(): number {
  const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
