/** Mean Rec. 601 luma of RGBA pixels, sampling one pixel in `step`. */
export function meanLuma(rgba: Uint8ClampedArray | Uint8Array, step = 16): number {
  const pixels = rgba.length >> 2;
  if (pixels === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p << 2;
    sum += 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
    count++;
  }
  return sum / count;
}
