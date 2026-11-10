import { describe, expect, it } from 'vitest';
import { aimWindowRect, DEFAULT_AIM, decodeSize, viewportRectToSource } from './geometry';

describe('aimWindowRect', () => {
  it('follows the design on an iPhone 14 viewport (390 × 844)', () => {
    expect(aimWindowRect({ width: 390, height: 844 })).toEqual({
      x: 32,
      y: 844 * 0.36 - 80,
      width: 326,
      height: 160,
    });
  });

  it('stays inside a short viewport', () => {
    const r = aimWindowRect({ width: 300, height: 120 }, DEFAULT_AIM);
    expect(r.height).toBe(120);
    expect(r.y).toBe(0);
  });

  it('never returns a negative width', () => {
    expect(aimWindowRect({ width: 40, height: 400 }).width).toBe(0);
  });
});

describe('viewportRectToSource', () => {
  it('is the identity when the video matches the viewport', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(viewportRectToSource({ width: 400, height: 300 }, { width: 400, height: 300 }, rect)).toEqual(rect);
  });

  it('maps through object-fit: cover on a portrait iPhone with a 1080 × 1920 stream', () => {
    const viewport = { width: 390, height: 844 };
    const video = { width: 1080, height: 1920 };
    const aim = aimWindowRect(viewport);
    const src = viewportRectToSource(viewport, video, aim);
    // scale = max(390/1080, 844/1920) = 0.43958…, horizontal crop offset = (390 − 1080·scale) / 2.
    const scale = 844 / 1920;
    const offsetX = (390 - 1080 * scale) / 2;
    expect(src).not.toBeNull();
    expect(src?.x).toBe(Math.floor((32 - offsetX) / scale));
    expect(src?.y).toBe(Math.floor(aim.y / scale));
    expect(src?.width).toBeCloseTo(326 / scale, -1);
    expect(src?.height).toBeCloseTo(160 / scale, -1);
  });

  it('crops letterboxed sides away with a landscape stream on a portrait screen', () => {
    const viewport = { width: 390, height: 844 };
    const video = { width: 1920, height: 1080 };
    const src = viewportRectToSource(viewport, video, aimWindowRect(viewport));
    expect(src).not.toBeNull();
    // Only a centred slice of the 1920 px width is visible.
    expect(src?.x).toBeGreaterThan(600);
    expect((src?.x ?? 0) + (src?.width ?? 0)).toBeLessThan(1320);
  });

  it('adds padding and clamps to the frame', () => {
    const viewport = { width: 100, height: 100 };
    const video = { width: 100, height: 100 };
    expect(viewportRectToSource(viewport, video, { x: 10, y: 10, width: 80, height: 80 }, 20)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it('returns null for empty sizes or a rect outside the video', () => {
    expect(
      viewportRectToSource({ width: 0, height: 100 }, { width: 10, height: 10 }, { x: 0, y: 0, width: 1, height: 1 }),
    ).toBeNull();
    expect(
      viewportRectToSource({ width: 100, height: 100 }, { width: 0, height: 0 }, { x: 0, y: 0, width: 1, height: 1 }),
    ).toBeNull();
    expect(
      viewportRectToSource(
        { width: 100, height: 100 },
        { width: 100, height: 100 },
        { x: 200, y: 0, width: 10, height: 10 },
      ),
    ).toBeNull();
  });
});

describe('decodeSize', () => {
  it('keeps small crops', () => {
    expect(decodeSize({ width: 742, height: 364 }, 1280)).toEqual({ width: 742, height: 364 });
  });

  it('scales the long side down to the cap', () => {
    expect(decodeSize({ width: 2560, height: 640 }, 1280)).toEqual({ width: 1280, height: 320 });
  });
});
