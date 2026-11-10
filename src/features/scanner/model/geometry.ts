export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Reticle geometry from the design (4.4.1): screen − 64 px wide, 160 px high, centred at 36 % of the height. */
export interface AimSpec {
  sideInset: number;
  height: number;
  centerY: number;
}

export const DEFAULT_AIM: AimSpec = { sideInset: 32, height: 160, centerY: 0.36 };

/** The aim window in the viewport's CSS pixels. */
export function aimWindowRect(viewport: Size, spec: AimSpec = DEFAULT_AIM): Rect {
  const width = Math.max(0, viewport.width - 2 * spec.sideInset);
  const height = Math.min(spec.height, viewport.height);
  const y = Math.min(Math.max(0, viewport.height * spec.centerY - height / 2), viewport.height - height);
  return { x: (viewport.width - width) / 2, y, width, height };
}

/**
 * Maps a rect in viewport CSS pixels to the video's source pixels, for a video drawn with
 * `object-fit: cover` and centred `object-position`. `padding` (CSS px) widens the crop on every side.
 * Returns null when the rect misses the video.
 */
export function viewportRectToSource(viewport: Size, video: Size, rect: Rect, padding = 0): Rect | null {
  if (viewport.width <= 0 || viewport.height <= 0 || video.width <= 0 || video.height <= 0) return null;
  const scale = Math.max(viewport.width / video.width, viewport.height / video.height);
  const offsetX = (viewport.width - video.width * scale) / 2;
  const offsetY = (viewport.height - video.height * scale) / 2;
  const x0 = Math.max(0, Math.floor((rect.x - padding - offsetX) / scale));
  const y0 = Math.max(0, Math.floor((rect.y - padding - offsetY) / scale));
  const x1 = Math.min(video.width, Math.ceil((rect.x + rect.width + padding - offsetX) / scale));
  const y1 = Math.min(video.height, Math.ceil((rect.y + rect.height + padding - offsetY) / scale));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Output size for the crop: unchanged, or scaled down so the long side is at most `maxSide`. */
export function decodeSize(crop: Size, maxSide: number): Size {
  const long = Math.max(crop.width, crop.height);
  if (long <= maxSide) return { width: crop.width, height: crop.height };
  const k = maxSide / long;
  return { width: Math.max(1, Math.round(crop.width * k)), height: Math.max(1, Math.round(crop.height * k)) };
}
