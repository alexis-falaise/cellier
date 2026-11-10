import type { LucideIcon } from 'lucide-react';
import { type CategoryHue, type CategoryVisual, tileStyle } from './categories';
import { cx } from './cx';

export type CategoryTileSize = 28 | 30 | 36 | 44 | 56 | 64 | 112 | 120;

const ICON_SIZE: Record<CategoryTileSize, number> = {
  28: 17,
  30: 17,
  36: 20,
  44: 20,
  56: 28,
  64: 28,
  112: 45,
  120: 48,
};

export interface CategoryTileProps {
  /** Resolved with `categoryVisual()`; or pass `icon` and `hue` directly. */
  visual?: CategoryVisual | undefined;
  icon?: LucideIcon | undefined;
  hue?: CategoryHue | undefined;
  size?: CategoryTileSize | undefined;
  /** Set when the category name is not said elsewhere; otherwise the tile is decorative. */
  label?: string | undefined;
  className?: string | undefined;
}

/** The category's Lucide glyph on its tinted rounded square (04 §3). Radius 10 at 36 px, scaled proportionally. */
export function CategoryTile({ visual, icon, hue, size = 36, label, className }: CategoryTileProps) {
  const Icon = visual?.icon ?? icon;
  const tone = visual?.hue ?? hue ?? 'pebble';
  const radius = size === 28 ? 6 : Math.round((size * 10) / 36);
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cx('inline-flex shrink-0 items-center justify-center', className)}
      style={{ ...tileStyle(tone), width: size, height: size, borderRadius: radius }}
    >
      {Icon ? (
        <Icon size={ICON_SIZE[size]} strokeWidth={size >= 56 ? 1.75 : 1.5} absoluteStrokeWidth aria-hidden="true" />
      ) : null}
    </span>
  );
}
