import { useState } from 'react';
import { CategoryTile, type CategoryTileSize } from './CategoryTile';
import type { CategoryVisual } from './categories';
import { cx } from './cx';

export interface ProductImageProps {
  src?: string | null | undefined;
  /** Fallback shown when there is no photo or it fails to load. */
  visual: CategoryVisual;
  size: 44 | 112 | 120;
  className?: string | undefined;
}

/**
 * Open Food Facts photo in a 1:1 frame on a light plate (01 §7): contain, 8 % padding, hairline ring, dimmed in dark
 * mode, fades in over 150 ms. Falls back to the category tile. `alt=""`: the name is adjacent.
 */
export function ProductImage({ src, visual, size, className }: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const radius = size === 44 ? 'rounded-sm' : 'rounded-lg';
  if (!src || failedSrc === src) {
    return <CategoryTile visual={visual} size={size as CategoryTileSize} className={className} />;
  }
  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 overflow-hidden bg-stone-0 ring-(length:--hairline) ring-separator ring-inset',
        radius,
        className,
      )}
      style={{ width: size, height: size, padding: size * 0.08 }}
    >
      <span aria-hidden="true" className={cx('absolute inset-0 bg-fill-tertiary', loadedSrc === src && 'hidden')} />
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
        className={cx(
          'relative size-full object-contain transition-opacity duration-150 ease-out dark:brightness-90',
          loadedSrc === src ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}
