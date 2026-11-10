import type { LucideIcon } from 'lucide-react';
import { animate, m, useMotionValue, useReducedMotion } from 'motion/react';
import { type MouseEvent, type ReactNode, useEffect, useRef } from 'react';
import { presets } from '@/shared/lib/motion';
import { cx } from './cx';
import { useElementWidth } from './hooks/useElementWidth';

export interface TabBarItem<K extends string = string> {
  key: K;
  label: string;
  icon: LucideIcon;
  href: string;
}

export interface TabBarProps<K extends string = string> {
  items: readonly TabBarItem<K>[];
  active: K;
  /** Navigation is the caller's: call `event.preventDefault()` and route. Re-tapping the active tab also calls it. */
  onSelect: (key: K, event: MouseEvent<HTMLAnchorElement>) => void;
  /** «Navigation principale». */
  label: string;
  /** The detached `ScanButton`. */
  scanButton?: ReactNode | undefined;
  hidden?: boolean | undefined;
}

/**
 * Floating 60 px capsule on translucent material with the scan button detached at its trailing end (04 §1, 03 §3.1).
 * Tabs switch instantly; only the selection capsule slides with `snappy`.
 */
export function TabBar<K extends string>({ items, active, onSelect, label, scanButton, hidden }: TabBarProps<K>) {
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const width = useElementWidth(listRef);
  const index = Math.max(
    0,
    items.findIndex((i) => i.key === active),
  );
  const itemWidth = items.length > 0 ? width / items.length : 0;
  const x = useMotionValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (itemWidth === 0) return;
    const target = index * itemWidth;
    if (!placed.current || reduced) {
      x.set(target);
      placed.current = true;
      return;
    }
    animate(x, target, presets.snappy);
  }, [index, itemWidth, reduced, x]);

  if (hidden) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-(--tab-bar-bottom) z-(--z-tab-bar) flex items-center gap-(--tab-bar-gap) pr-[calc(16px+var(--safe-right))] pl-[calc(16px+var(--safe-left))]">
      <nav
        aria-label={label}
        className="material pointer-events-auto h-(--tab-bar-height) min-w-0 flex-1 rounded-full border border-edge p-1 shadow-float"
      >
        <ul ref={listRef} className="relative flex h-full">
          {itemWidth > 0 ? (
            <m.li
              aria-hidden="true"
              className="absolute inset-y-0 left-0 rounded-full bg-fill-tertiary"
              style={{ x, width: itemWidth }}
            />
          ) : null}
          {items.map((item) => {
            const selected = item.key === active;
            const Icon = item.icon;
            return (
              <li key={item.key} className="relative flex-1">
                <a
                  href={item.href}
                  aria-current={selected ? 'page' : undefined}
                  onClick={(e) => onSelect(item.key, e)}
                  className={cx(
                    'flex h-full min-w-[76px] flex-col items-center justify-center gap-[3px] rounded-full outline-none',
                    'transition-colors duration-150 ease-out focus-visible:focus-ring focus-visible:-outline-offset-2',
                    selected ? 'text-accent-fg' : 'text-label-secondary',
                  )}
                >
                  <Icon size={24} strokeWidth={selected ? 2.25 : 1.75} absoluteStrokeWidth aria-hidden="true" />
                  <span className="type-tab-label">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      {scanButton ? <div className="pointer-events-auto z-(--z-scan-button)">{scanButton}</div> : null}
    </div>
  );
}
