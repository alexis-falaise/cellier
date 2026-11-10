import {
  type AnimationPlaybackControls,
  animate,
  type MotionValue,
  m,
  motionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  activationThreshold,
  decideEdgePop,
  edgeParentX,
  isEdgeStart,
  presets,
  releaseTransition,
  VelocityTracker,
} from '@/shared/lib/motion';
import { cx } from './cx';
import { isStandalone } from './hooks/viewport';

export interface StackScreen {
  key: string;
  element: ReactNode;
}

export interface ScreenStackProps {
  /** The navigation stack, root first. The router owns it; this only animates changes. */
  screens: readonly StackScreen[];
  /** Called when a left-edge swipe commits a pop: the caller runs `history.back()` (02 §3.6). */
  onBack?: (() => void) | undefined;
  /** Custom edge swipe; on by default only in the installed app. */
  edgeSwipe?: boolean | undefined;
  className?: string | undefined;
}

const ScreenScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** Scroll container of the current stack screen, for `LargeTitleHeader` / `NavBar`. */
export function useScreenScrollRef(): RefObject<HTMLDivElement | null> | undefined {
  return useContext(ScreenScrollContext) ?? undefined;
}

interface Layer {
  key: string;
  element: ReactNode;
  x: MotionValue<number>;
  opacity: MotionValue<number>;
  exiting: boolean;
}

interface EdgeState {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  phase: 'idle' | 'pending' | 'drag';
  width: number;
}

/**
 * Per-tab push / pop container (04 §1, 02 §4.1): push slides the new screen in from the right with `push` while the
 * parent shifts left by 30 % and dims; pop reverses from the current position. In the installed app a left-edge swipe
 * follows the finger 1:1 and releases with `fling`. Reduced motion: cross-fade.
 */
export function ScreenStack({ screens, onBack, edgeSwipe, className }: ScreenStackProps) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const anims = useRef(new Map<string, AnimationPlaybackControls>());
  const popVelocity = useRef<number | null>(null);

  const makeLayer = (s: StackScreen, x = 0): Layer => ({
    key: s.key,
    element: s.element,
    x: motionValue(x),
    opacity: motionValue(1),
    exiting: false,
  });

  // A cold deep link (e.g. a notification tap) mounts a pushed stack: park the parent where a push leaves it, so a
  // later pop slides it back in the same way.
  const [layers, setLayers] = useState<Layer[]>(() =>
    screens.map((s, i) => makeLayer(s, !reduced && i === screens.length - 2 ? -0.3 * (window.innerWidth || 390) : 0)),
  );
  const [seenScreens, setSeenScreens] = useState(screens);
  const pending = useRef<{ kind: 'push' | 'pop'; key: string } | null>(null);

  // Reconcile the router's stack with the rendered layers during render (no extra frame).
  if (seenScreens !== screens) {
    setSeenScreens(screens);
    const keys = new Set(screens.map((s) => s.key));
    const prevTop = layers.filter((l) => !l.exiting).at(-1);
    const nextTop = screens.at(-1);
    const W = rootRef.current?.offsetWidth ?? 390;
    const next: Layer[] = [];
    for (const s of screens) {
      const existing = layers.find((l) => l.key === s.key);
      next.push(existing ? { ...existing, element: s.element, exiting: false } : makeLayer(s, reduced ? 0 : W));
    }
    for (const l of layers) if (!keys.has(l.key)) next.push({ ...l, exiting: true });
    if (prevTop && nextTop && prevTop.key !== nextTop.key) {
      pending.current = keys.has(prevTop.key) ? { kind: 'push', key: nextTop.key } : { kind: 'pop', key: prevTop.key };
      const entering = next.find((l) => l.key === nextTop.key);
      if (entering && pending.current.kind === 'push' && reduced) entering.opacity.set(0);
    }
    // Exiting layers render above the stack.
    next.sort((a, b) => Number(a.exiting) - Number(b.exiting));
    setLayers(next);
  }

  const run = (
    id: string,
    mv: MotionValue<number>,
    target: number,
    transition: Parameters<typeof animate>[2],
    done?: () => void,
  ) => {
    anims.current.get(id)?.stop();
    const controls = animate(mv, target, transition as never);
    anims.current.set(id, controls);
    if (done) controls.then(done);
  };

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const W = rootRef.current?.offsetWidth ?? 390;
    const live = layers.filter((l) => !l.exiting);
    const top = live.at(-1);
    const parent = live.at(-2);
    const removeExiting = (key: string) => setLayers((ls) => ls.filter((l) => !(l.exiting && l.key === key)));

    if (p.kind === 'push' && top) {
      if (reduced) {
        run(`${top.key}:o`, top.opacity, 1, presets.reduced);
      } else {
        run(`${top.key}:x`, top.x, 0, presets.push);
        if (parent) run(`${parent.key}:x`, parent.x, -0.3 * W, presets.push);
      }
      return;
    }
    const exiting = layers.find((l) => l.exiting && l.key === p.key);
    if (!exiting) return;
    const v = popVelocity.current;
    popVelocity.current = null;
    if (reduced) {
      run(`${exiting.key}:o`, exiting.opacity, 0, presets.reduced, () => removeExiting(exiting.key));
      if (top) top.x.set(0);
      return;
    }
    const transition = v === null ? presets.push : releaseTransition(v, 'push', false);
    run(`${exiting.key}:x`, exiting.x, W, transition, () => removeExiting(exiting.key));
    if (top) run(`${top.key}:x`, top.x, 0, transition);
  });

  // ------------------------------------------------------------------ edge swipe
  const edge = useRef<EdgeState>({ id: -1, pointerType: 'touch', startX: 0, startY: 0, phase: 'idle', width: 0 });
  const tracker = useRef(new VelocityTracker());
  const live = layers.filter((l) => !l.exiting);
  const edgeEnabled = (edgeSwipe ?? isStandalone()) && live.length >= 2 && onBack !== undefined;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!edgeEnabled || !isEdgeStart(e.clientX - (rootRef.current?.getBoundingClientRect().left ?? 0))) return;
    const d = edge.current;
    d.id = e.pointerId;
    d.pointerType = e.pointerType;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.phase = 'pending';
    d.width = rootRef.current?.offsetWidth ?? 390;
    tracker.current.reset();
    tracker.current.add(e.clientX, e.timeStamp);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = edge.current;
    if (d.id !== e.pointerId || d.phase === 'idle') return;
    tracker.current.add(e.clientX, e.timeStamp);
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const top = live.at(-1);
    const parent = live.at(-2);
    if (!top || !parent) return;
    if (d.phase === 'pending') {
      if (Math.hypot(dx, dy) < activationThreshold(d.pointerType)) return;
      if (Math.abs(dy) > Math.abs(dx) || dx <= 0) {
        d.phase = 'idle';
        return;
      }
      d.phase = 'drag';
      for (const a of anims.current.values()) a.stop();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const x = Math.max(0, dx);
    top.x.set(x);
    parent.x.set(edgeParentX(x, d.width));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = edge.current;
    if (d.id !== e.pointerId) return;
    const wasDragging = d.phase === 'drag';
    d.id = -1;
    d.phase = 'idle';
    if (!wasDragging) return;
    const top = live.at(-1);
    const parent = live.at(-2);
    if (!top || !parent) return;
    const v = cancelled ? 0 : tracker.current.velocity(e.timeStamp);
    if (!cancelled && decideEdgePop(top.x.get(), v, d.width)) {
      popVelocity.current = reduced ? 0 : v;
      onBack?.();
      return;
    }
    const transition = releaseTransition(v, 'push', reduced);
    run(`${top.key}:x`, top.x, 0, transition);
    run(`${parent.key}:x`, parent.x, -0.3 * d.width, transition);
  };

  return (
    <div
      ref={rootRef}
      className={cx('relative isolate flex-1 overflow-hidden', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, false)}
      onPointerCancel={(e) => onPointerEnd(e, true)}
    >
      {layers.map((layer) => {
        const index = live.indexOf(layer);
        const isTop = !layer.exiting && index === live.length - 1;
        const isParent = !layer.exiting && index === live.length - 2;
        const hidden = !layer.exiting && !isTop && !isParent;
        const exitingAbove = layers.find((l) => l.exiting);
        const above = layer.exiting ? undefined : (live[index + 1] ?? (isTop ? exitingAbove : undefined));
        return (
          <StackLayerView
            key={layer.key}
            layer={layer}
            active={isTop}
            hidden={hidden}
            aboveX={above?.x}
            width={rootRef.current?.offsetWidth ?? 390}
          />
        );
      })}
    </div>
  );
}

interface StackLayerViewProps {
  layer: Layer;
  active: boolean;
  hidden: boolean;
  aboveX: MotionValue<number> | undefined;
  width: number;
}

function StackLayerView({ layer, active, hidden, aboveX, width }: StackLayerViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fallback] = useState(() => motionValue(width));
  const source = aboveX ?? fallback;
  const scrim = useTransform(source, (v) => Math.max(0, Math.min(1, 1 - v / Math.max(1, width))));
  return (
    <m.div
      className={cx(
        // Own stacking context: a lower layer's sticky header (z-sticky) must never paint over the screen above it.
        'absolute inset-0 isolate bg-bg-grouped',
        hidden && 'invisible',
        // Static soft shadow on the leading edge of the incoming screen.
        'shadow-[-8px_0_24px_-12px_oklch(0.2_0.01_80/0.25)]',
      )}
      style={{ x: layer.x, opacity: layer.opacity }}
      inert={!active || undefined}
      aria-hidden={active ? undefined : true}
    >
      <ScreenScrollContext.Provider value={scrollRef}>
        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overscroll-contain">
          {layer.element}
        </div>
      </ScreenScrollContext.Provider>
      <m.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-black/10 dark:bg-black/30"
        style={{ opacity: scrim }}
      />
    </m.div>
  );
}
