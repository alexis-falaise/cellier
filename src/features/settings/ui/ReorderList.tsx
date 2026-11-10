import { GripHorizontal } from 'lucide-react';
import { animate, type MotionValue, m, motionValue, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { presetFor, releaseTransition } from '@/shared/lib/motion';
import { cx } from '@/shared/ui';
import { dropIndex, type RowBox, rowShift, slotOffset } from '../model/reorder';

export interface ReorderListProps<T> {
  items: readonly T[];
  getId: (item: T) => string;
  /** Accessible name of the handle, e.g. «Déplacer « Fruits »». */
  handleLabel: (item: T) => string;
  /** Hint read with the handle. */
  handleHint: string;
  renderRow: (item: T, handle: ReactNode) => ReactNode;
  onMove: (from: number, to: number) => void;
}

interface Drag {
  pointerId: number;
  from: number;
  startY: number;
  rows: RowBox[];
  target: number;
  lastY: number;
  lastT: number;
  velocity: number;
}

/**
 * Edit mode of an ordered list (03 §4.13.1): each row has a drag handle; the row follows the finger
 * 1:1, its neighbours make room with `smooth`, the release settles into the slot (02 §1.3) and the new
 * order is committed. Arrow keys on the handle move a row by one place.
 */
export function ReorderList<T>({ items, getId, handleLabel, handleHint, renderRow, onMove }: ReorderListProps<T>) {
  const reduced = useReducedMotion();
  const offsets = useRef(new Map<string, MotionValue<number>>());
  const shifts = useRef(new Map<string, number>());
  const refs = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const offset = (id: string) => {
    let mv = offsets.current.get(id);
    if (!mv) {
      mv = motionValue(0);
      offsets.current.set(id, mv);
    }
    return mv;
  };

  // A committed move re-renders rows in their new order: clear the offsets in the same frame.
  const order = items.map(getId).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the order changes
  useLayoutEffect(() => {
    for (const mv of offsets.current.values()) {
      mv.stop();
      mv.set(0);
    }
    shifts.current.clear();
  }, [order]);

  const measure = (): RowBox[] =>
    items.map((item) => {
      const el = refs.current.get(getId(item));
      return { top: el?.offsetTop ?? 0, height: el?.offsetHeight ?? 52 };
    });

  const onPointerDown = (index: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      from: index,
      startY: e.clientY,
      rows: measure(),
      target: index,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    };
    setDragging(getId(items[index] as T));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = ((e.clientY - d.lastY) / dt) * 1000;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const dy = e.clientY - d.startY;
    offset(getId(items[d.from] as T)).set(dy);
    const target = dropIndex(d.rows, d.from, dy);
    if (target === d.target) return;
    d.target = target;
    const height = d.rows[d.from]?.height ?? 52;
    items.forEach((item, i) => {
      if (i === d.from) return;
      const id = getId(item);
      const shift = rowShift(i, d.from, target, height);
      if (shifts.current.get(id) === shift) return;
      shifts.current.set(id, shift);
      animate(offset(id), shift, presetFor('smooth', reduced));
    });
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const id = getId(items[d.from] as T);
    const settle = animate(
      offset(id),
      slotOffset(d.rows, d.from, d.target),
      releaseTransition(d.velocity, 'snappy', reduced),
    );
    void settle.then(() => {
      setDragging(null);
      if (d.target !== d.from) onMove(d.from, d.target);
    });
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= items.length) return;
    e.preventDefault();
    onMove(index, to);
  };

  return (
    <>
      {items.map((item, index) => {
        const id = getId(item);
        const handle = (
          <button
            type="button"
            data-sheet-nodrag=""
            aria-label={handleLabel(item)}
            aria-description={handleHint}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown(index)}
            className="-mr-2 flex size-11 shrink-0 touch-none items-center justify-center rounded-sm text-label-tertiary outline-none focus-visible:focus-ring"
          >
            <GripHorizontal size={20} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          </button>
        );
        return (
          <m.div
            key={id}
            ref={(el: HTMLDivElement | null) => {
              if (el) refs.current.set(id, el);
              else refs.current.delete(id);
            }}
            style={{ y: offset(id) }}
            className={cx('relative bg-surface-elevated', dragging === id && 'z-10 shadow-float')}
          >
            {renderRow(item, handle)}
          </m.div>
        );
      })}
    </>
  );
}
