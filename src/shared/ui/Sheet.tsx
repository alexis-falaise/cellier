import {
  type AnimationPlaybackControls,
  animate,
  type MotionValue,
  m,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  createContext,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { createCommitHaptic } from '@/shared/lib/haptics';
import {
  activationThreshold,
  clamp,
  closedTop,
  type Detent,
  decideSheetRelease,
  detentTop,
  lockAxis,
  presets,
  releaseTransition,
  type SheetGeometry,
  sheetDismissThreshold,
  sheetDragTop,
  THRESHOLDS,
  VelocityTracker,
} from '@/shared/lib/motion';
import { cx } from './cx';
import { useModalFocus } from './hooks/useModalFocus';
import { keyboardInset, readSafeArea, viewportHeight } from './hooks/viewport';
import { ElevatedSurfaceContext } from './surface';

/** Stacking layer of a sheet: the app's, or above the scanner cover (tokens `--z-over-scanner-*`). */
export type OverlayLayer = 'app' | 'over-scanner';

const LAYER_Z: Record<OverlayLayer, { scrim: string; sheet: string; menu: string }> = {
  app: { scrim: 'var(--z-scrim)', sheet: 'var(--z-sheet)', menu: 'var(--z-menu)' },
  'over-scanner': {
    scrim: 'var(--z-over-scanner-scrim)',
    sheet: 'var(--z-over-scanner-sheet)',
    menu: 'var(--z-over-scanner-menu)',
  },
};

/** z-index of an overlay part on a layer (`depth` lifts nested sheets). */
export function layerZ(layer: OverlayLayer, part: 'scrim' | 'sheet' | 'menu', depth = 0): string {
  const base = LAYER_Z[layer][part];
  return depth === 0 ? base : `calc(${base} + ${depth})`;
}

interface SheetStack {
  depth: number;
  /** Layer of the outermost sheet; nested sheets inherit it. */
  layer: OverlayLayer;
  /** Progress (0..1) of the child sheet opened over this one, driving the push-back. */
  childProgress: MotionValue<number> | null;
}

const SheetStackContext = createContext<SheetStack>({ depth: 0, layer: 'app', childProgress: null });
const SheetTitleContext = createContext<string | undefined>(undefined);

export type { Detent } from '@/shared/lib/motion';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Allowed detents (02 §3.2). Default `['fit']`. */
  detents?: Detent[] | undefined;
  initialDetent?: Detent | undefined;
  /** Title of the default header; also the dialog's accessible name. */
  title?: string | undefined;
  /** Leading header slot, e.g. «Annuler». */
  leading?: ReactNode | undefined;
  /** Trailing header slot, e.g. «OK». */
  trailing?: ReactNode | undefined;
  /** Replaces the default header (use `SheetHeader`). */
  header?: ReactNode | undefined;
  /** Sticky footer above the home indicator (primary button). */
  footer?: ReactNode | undefined;
  /** Unsaved edits: a drag, scrim tap or Escape calls `onDismissBlocked` instead of closing. */
  dirty?: boolean | undefined;
  onDismissBlocked?: (() => void) | undefined;
  /** False for sheets that can only close from their own buttons. */
  dismissible?: boolean | undefined;
  /** Label of the grabber button for VoiceOver, e.g. «Fermer». */
  closeLabel: string;
  /** Accessible name when there is no title. */
  'aria-label'?: string | undefined;
  /** Called once the close animation has finished and the sheet unmounted. */
  onExited?: (() => void) | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
  /** Stacking layer; `'over-scanner'` opens above the scanner cover. Nested sheets inherit their parent's. */
  layer?: OverlayLayer | undefined;
}

interface DragState {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  originY: number;
  startTop: number;
  source: 'handle' | 'body';
  scroller: HTMLElement | null;
  phase: 'pending' | 'drag' | 'abandoned';
  armed: boolean;
}

/**
 * The single bottom-sheet primitive (04 §2, 02 §3.2): detents fit / medium / large, 1:1 drag with rubber band above
 * the top detent, velocity veto and projection on release, `fling` with velocity hand-off, scrim tied to position,
 * stacked push-back, focus management. Presentational: the URL owns `open`.
 */
export function Sheet({
  open,
  onOpenChange,
  detents = ['fit'],
  initialDetent,
  title,
  leading,
  trailing,
  header,
  footer,
  dirty = false,
  onDismissBlocked,
  dismissible = true,
  closeLabel,
  'aria-label': ariaLabel,
  onExited,
  children,
  className,
  layer,
}: SheetProps) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  if (!present || typeof document === 'undefined') return null;
  return createPortal(
    <SheetPanel
      open={open}
      onOpenChange={onOpenChange}
      detents={detents}
      initialDetent={initialDetent ?? (detents[0] as Detent)}
      title={title}
      leading={leading}
      trailing={trailing}
      header={header}
      footer={footer}
      dirty={dirty}
      onDismissBlocked={onDismissBlocked}
      dismissible={dismissible}
      closeLabel={closeLabel}
      ariaLabel={ariaLabel}
      className={className}
      layer={layer}
      onExited={() => {
        setPresent(false);
        onExited?.();
      }}
    >
      {children}
    </SheetPanel>,
    document.body,
  );
}

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detents: Detent[];
  initialDetent: Detent;
  title: string | undefined;
  leading: ReactNode;
  trailing: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  dirty: boolean;
  onDismissBlocked: (() => void) | undefined;
  dismissible: boolean;
  closeLabel: string;
  ariaLabel: string | undefined;
  className: string | undefined;
  onExited: () => void;
  children: ReactNode;
  layer: OverlayLayer | undefined;
}

function SheetPanel(props: PanelProps) {
  const { open, detents, title, leading, trailing, header, footer, closeLabel, ariaLabel, className, children } = props;
  const parent = useContext(SheetStackContext);
  const depth = parent.depth;
  const layer = props.layer ?? parent.layer;
  const reduced = useReducedMotion();
  const titleId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(10000);
  const fade = useMotionValue(reduced ? 0 : 1);
  const kb = useMotionValue(0);
  const childProgress = useMotionValue(0);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const fadeAnim = useRef<AnimationPlaybackControls | null>(null);

  const geo = useRef<SheetGeometry & { largeTop: number }>({ viewportHeight: 0, safeTop: 0, largeTop: 0 });
  const restDetent = useRef<Detent>(props.initialDetent);
  const closing = useRef<'none' | 'gesture' | 'programmatic'>('none');
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const isFit = detents.length === 1 && detents[0] === 'fit';

  const measure = () => {
    const H = viewportHeight();
    const safeTop = readSafeArea().top;
    const largeTop = safeTop + THRESHOLDS.sheet.largeOffset;
    const content = contentRef.current;
    const contentHeight = content ? content.offsetHeight : H;
    geo.current = { viewportHeight: H, safeTop, contentHeight, largeTop };
  };
  const topOf = (d: Detent) => detentTop(d, geo.current);
  const tops = () => latest.current.detents.map(topOf);
  const closed = () => closedTop(geo.current);
  const lowestTop = () => Math.max(...tops());
  const highestTop = () => Math.min(...tops());

  const run = (target: number, transition: Parameters<typeof animate>[2], onDone?: () => void) => {
    anim.current?.stop();
    const controls = animate(y, target, transition as never);
    anim.current = controls;
    if (onDone) controls.then(onDone);
  };
  const runFade = (target: number, onDone?: () => void) => {
    fadeAnim.current?.stop();
    const controls = animate(fade, target, presets.reduced);
    fadeAnim.current = controls;
    if (onDone) controls.then(onDone);
  };

  const finishClose = () => {
    if (latest.current.open) return;
    latest.current.onExited();
  };

  // Open on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
  useLayoutEffect(() => {
    measure();
    const target = topOf(restDetent.current);
    if (reduced) {
      y.set(target);
      fade.set(0);
      runFade(1);
    } else {
      y.set(closed());
      run(target, presets.sheet);
    }
  }, []);

  // Close when the URL says so (button, scrim, Back), unless a gesture already started the exit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to `open` only
  useEffect(() => {
    if (open) {
      if (closing.current !== 'none') {
        closing.current = 'none';
        measure();
        if (reduced) runFade(1);
        run(topOf(restDetent.current), presets.sheet);
      }
      return;
    }
    if (closing.current === 'gesture') return;
    closing.current = 'programmatic';
    if (reduced) runFade(0, finishClose);
    else run(closed(), presets.sheet, finishClose);
  }, [open]);

  // Fit sheets follow their content height while resting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observer set up once
  useEffect(() => {
    const panel = contentRef.current;
    if (!isFit || !panel || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (drag.current.phase === 'drag' || closing.current !== 'none') return;
      const before = topOf('fit');
      measure();
      const after = topOf('fit');
      if (Math.abs(after - before) > 0.5) run(after, reduced ? { duration: 0 } : presets.snappy);
    });
    ro.observe(panel);
    return () => ro.disconnect();
  }, [isFit]);

  // Viewport and keyboard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners set up once
  useEffect(() => {
    const onResize = () => {
      if (drag.current.phase === 'drag' || closing.current !== 'none') return;
      measure();
      y.set(topOf(restDetent.current));
    };
    const vv = window.visualViewport;
    const onViewport = () => {
      animate(kb, keyboardInset(), reduced ? { duration: 0 } : presets.snappy);
    };
    window.addEventListener('resize', onResize);
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', onViewport);
    return () => {
      window.removeEventListener('resize', onResize);
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
    };
  }, []);

  const requestDismiss = () => {
    const p = latest.current;
    if (!p.dismissible) return;
    if (p.dirty) {
      p.onDismissBlocked?.();
      return;
    }
    p.onOpenChange(false);
  };

  useModalFocus(panelRef, open, requestDismiss);

  // A medium sheet moves to large when one of its fields gains focus (02 §3.2).
  const onFocusCapture = (e: ReactFocusEvent) => {
    const t = e.target as HTMLElement;
    if (!t.matches('input,textarea,select,[contenteditable="true"]')) return;
    if (restDetent.current === 'medium' && latest.current.detents.includes('large')) {
      restDetent.current = 'large';
      run(topOf('large'), reduced ? { duration: 0 } : presets.sheet);
    }
  };

  // ------------------------------------------------------------------ gestures
  const drag = useRef<DragState>({
    id: -1,
    pointerType: 'touch',
    startX: 0,
    startY: 0,
    originY: 0,
    startTop: 0,
    source: 'handle',
    scroller: null,
    phase: 'abandoned',
    armed: false,
  });
  const tracker = useRef(new VelocityTracker());
  const commitHaptic = useRef(createCommitHaptic());
  const lastScrollAt = useRef(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (closing.current !== 'none') return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-sheet-nodrag]')) return;
    const fromHandle = target.closest('[data-sheet-handle]') !== null;
    const scroller = fromHandle ? null : target.closest<HTMLElement>('[data-sheet-scroll]');
    if (!fromHandle && e.pointerType === 'mouse') return;
    measure();
    const d = drag.current;
    d.id = e.pointerId;
    d.pointerType = e.pointerType;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.startTop = y.get();
    d.source = fromHandle ? 'handle' : 'body';
    d.scroller = scroller;
    d.phase = 'pending';
    d.armed = false;
    tracker.current.reset();
    tracker.current.add(e.clientY, e.timeStamp);
    commitHaptic.current.reset();
  };

  const canBodyDrag = (dy: number): boolean => {
    const d = drag.current;
    if (d.source === 'handle') return true;
    if (performance.now() - lastScrollAt.current < THRESHOLDS.sheet.scrollLockMs) return false;
    const atTop = !d.scroller || d.scroller.scrollTop <= 0;
    if (dy > 0) return atTop;
    // Upward: expand to a higher detent first, as iOS does.
    return d.startTop > highestTop() + 1;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== e.pointerId || d.phase === 'abandoned') return;
    tracker.current.add(e.clientY, e.timeStamp);
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.phase === 'pending') {
      const axis = lockAxis(dx, dy, activationThreshold(d.pointerType));
      if (axis === null) return;
      if (axis === 'x' || !canBodyDrag(dy)) {
        d.phase = 'abandoned';
        return;
      }
      anim.current?.stop();
      d.startTop = y.get();
      d.originY = e.clientY;
      d.phase = 'drag';
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const top = sheetDragTop(d.startTop + (e.clientY - d.originY), highestTop());
    y.set(top);
    const p = latest.current;
    if (!p.dismissible || p.dirty) return;
    const threshold = sheetDismissThreshold(lowestTop(), geo.current.viewportHeight);
    if (!d.armed && top >= threshold) {
      d.armed = true;
      commitHaptic.current.arm();
    } else if (d.armed && top < threshold - THRESHOLDS.sheet.hapticRearm) {
      d.armed = false;
      commitHaptic.current.rearm();
    }
  };

  const release = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    const wasDragging = d.phase === 'drag';
    d.id = -1;
    d.phase = 'abandoned';
    if (!wasDragging) return;
    const v = cancelled ? 0 : tracker.current.velocity(e.timeStamp);
    const p = latest.current;
    const decision = decideSheetRelease({
      top: y.get(),
      velocity: v,
      startTop: topOf(restDetent.current),
      detentTops: tops(),
      closedTop: closed(),
      viewportHeight: geo.current.viewportHeight,
      dismissible: p.dismissible,
    });
    if (decision.kind === 'dismiss') {
      if (p.dirty) {
        run(topOf(restDetent.current), releaseTransition(v, 'sheet', reduced));
        p.onDismissBlocked?.();
        return;
      }
      commitHaptic.current.commit();
      closing.current = 'gesture';
      if (reduced) runFade(0, finishClose);
      else run(closed(), releaseTransition(v, 'sheet', false), finishClose);
      p.onOpenChange(false);
      return;
    }
    const detent = p.detents.find((dt) => Math.abs(topOf(dt) - decision.top) < 0.5);
    if (detent) restDetent.current = detent;
    run(decision.top, releaseTransition(v, 'sheet', reduced));
  };

  // Block native scroll while the sheet takes the touch (no pointercancel mid-drag).
  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners set up once
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = drag.current;
      if (d.phase === 'drag') {
        e.preventDefault();
        return;
      }
      if (d.phase !== 'pending' || d.source !== 'body') return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      if (dy > 0 && canBodyDrag(dy)) e.preventDefault();
    };
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLElement && t.hasAttribute('data-sheet-scroll')) lastScrollAt.current = performance.now();
    };
    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);

  // ------------------------------------------------------------------ derived visuals
  const progress = useTransform(y, (v) => {
    const g = geo.current;
    if (g.viewportHeight === 0) return 0;
    const c = closedTop(g);
    const low = Math.max(...latest.current.detents.map((dt) => detentTop(dt, g)));
    return clamp((c - v) / Math.max(1, c - low), 0, 1);
  });
  const scrimOpacity = useTransform([y, fade], ([vy, f]) => {
    const g = geo.current;
    if (g.viewportHeight === 0) return 0;
    const c = closedTop(g);
    const large = g.largeTop;
    const low = Math.max(...latest.current.detents.map((dt) => detentTop(dt, g)));
    const lowValue = low <= large + 1 ? 1 : 0.6;
    const v = vy as number;
    const level =
      v >= low
        ? lowValue * clamp((c - v) / Math.max(1, c - low), 0, 1)
        : lowValue + (1 - lowValue) * clamp((low - v) / Math.max(1, low - large), 0, 1);
    return level * (f as number);
  });

  // Tell the parent sheet how far this one is open.
  useMotionValueEvent(progress, 'change', (v) => parent.childProgress?.set(v));
  useEffect(() => {
    const pc = parent.childProgress;
    return () => pc?.set(0);
  }, [parent.childProgress]);

  const pushScale = useTransform(childProgress, [0, 1], [1, 0.94]);
  const pushY = useTransform(childProgress, [0, 1], [0, -10]);
  const pushScrim = useTransform(childProgress, [0, 1], [0, 0.5]);
  const footerY = useTransform(kb, (v) => -v);

  const zSheet = layerZ(layer, 'sheet', depth);
  const hasHeader = header !== undefined || title !== undefined || leading !== undefined || trailing !== undefined;

  return (
    <SheetStackContext.Provider value={{ depth: depth + 1, layer, childProgress }}>
      <SheetTitleContext.Provider value={title ? titleId : undefined}>
        <ElevatedSurfaceContext.Provider value={true}>
          {depth === 0 ? (
            <m.div
              aria-hidden="true"
              className="fixed inset-0 bg-scrim"
              style={{ opacity: scrimOpacity, zIndex: layerZ(layer, 'scrim') }}
              onClick={requestDismiss}
            />
          ) : (
            <div aria-hidden="true" className="fixed inset-0" style={{ zIndex: zSheet }} onClick={requestDismiss} />
          )}
          <m.div className="fixed inset-x-0 top-0 will-change-transform" style={{ y, opacity: fade, zIndex: zSheet }}>
            <m.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-label={title ? undefined : ariaLabel}
              tabIndex={-1}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => release(e, false)}
              onPointerCancel={(e) => release(e, true)}
              onFocusCapture={onFocusCapture}
              style={{ scale: pushScale, y: pushY, transformOrigin: '50% 0%' }}
              className={cx(
                'relative mx-auto flex w-full max-w-[600px] flex-col rounded-t-xl bg-bg-elevated shadow-sheet outline-none',
                className,
              )}
            >
              <div
                ref={contentRef}
                className={cx(
                  'flex flex-col',
                  isFit ? 'max-h-[calc(100dvh-var(--safe-top)-10px)]' : 'h-[calc(100dvh-var(--safe-top)-10px)]',
                )}
              >
                <div data-sheet-handle="" className="relative shrink-0 touch-none select-none">
                  <button
                    type="button"
                    aria-label={closeLabel}
                    onClick={requestDismiss}
                    className="absolute top-0 left-1/2 flex h-5 w-11 -translate-x-1/2 items-start justify-center pt-1.5 outline-none focus-visible:focus-ring"
                  >
                    <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-label-tertiary opacity-50" />
                  </button>
                  {hasHeader ? (
                    <div className="pt-3.5">
                      {header ?? <SheetHeader title={title} leading={leading} trailing={trailing} />}
                    </div>
                  ) : (
                    <div className="h-5" />
                  )}
                </div>
                <div
                  data-sheet-scroll=""
                  className={cx(
                    'min-h-0 flex-1 overflow-y-auto overscroll-contain',
                    !footer && 'pb-[calc(var(--safe-bottom)+16px)]',
                  )}
                >
                  {children}
                </div>
                {footer ? (
                  <m.div
                    className="shrink-0 bg-bg-elevated px-4 pt-3 pb-[calc(var(--safe-bottom)+16px)]"
                    style={{ y: footerY }}
                  >
                    {footer}
                  </m.div>
                ) : null}
              </div>
              {/* Overshoot bleed: a spring overshoot never reveals a gap under the sheet. */}
              <div aria-hidden="true" className="absolute inset-x-0 top-full h-10 bg-bg-elevated" />
              <m.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-t-xl bg-scrim"
                style={{ opacity: pushScrim }}
              />
            </m.div>
          </m.div>
        </ElevatedSurfaceContext.Provider>
      </SheetTitleContext.Provider>
    </SheetStackContext.Provider>
  );
}

export interface SheetHeaderProps {
  title?: ReactNode | undefined;
  leading?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
}

/** 56 px header: leading text button, centred Headline title, trailing text button (03 §3.6). */
export function SheetHeader({ title, leading, trailing }: SheetHeaderProps) {
  const titleId = useContext(SheetTitleContext);
  return (
    <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2">
      <div className="flex min-w-0 justify-start" data-sheet-nodrag="">
        {leading}
      </div>
      {title ? (
        <h2 id={titleId} data-dialog-title="" tabIndex={-1} className="truncate type-headline outline-none">
          {title}
        </h2>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 justify-end" data-sheet-nodrag="">
        {trailing}
      </div>
    </div>
  );
}

export interface SheetTextButtonProps {
  children: ReactNode;
  onPress: () => void;
  emphasis?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Focus this button when the sheet opens. */
  autoFocus?: boolean | undefined;
}

/** Text button of a sheet header: Body (leading) or Headline (trailing), accent; tertiary when disabled. */
export function SheetTextButton({
  children,
  onPress,
  emphasis = false,
  disabled = false,
  autoFocus,
}: SheetTextButtonProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      data-autofocus={autoFocus ? '' : undefined}
      className={cx(
        'min-h-11 rounded-sm px-2 outline-none transition-opacity duration-150 ease-out focus-visible:focus-ring',
        'active:opacity-60 active:transition-none',
        emphasis ? 'type-headline' : 'type-body',
        disabled ? 'text-label-tertiary' : 'text-accent-fg',
      )}
    >
      {children}
    </button>
  );
}
