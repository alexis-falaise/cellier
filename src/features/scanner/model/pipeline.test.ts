import { describe, expect, it } from 'vitest';
import { createDuplicateFilter } from './dedupe';
import { preflightError, toScannerError } from './errors';
import { createLowLightMonitor } from './lowLight';
import { meanLuma } from './luma';
import { acceptSymbols, dedupeKey, FrameGate } from './pipeline';

// One read is enough here: these tests are about parsing, not confirmation.
const single = () => createDuplicateFilter({ confirmFrames: 1 });

describe('acceptSymbols', () => {
  it('turns decoder output into parsed codes', () => {
    const out = acceptSymbols([{ text: '3017620422003', format: 'EAN13' }], single(), 0);
    expect(out).toEqual([
      {
        kind: 'product',
        format: 'EAN-13',
        digits: '3017620422003',
        gtin14: '03017620422003',
        offCode: '3017620422003',
      },
    ]);
  });

  it('accepts what zxing-cpp returns for UPC-A and UPC-E (13-digit forms)', () => {
    const f = single();
    const [upca] = acceptSymbols([{ text: '0036000291452', format: 'EAN13' }], f, 0);
    const [upce] = acceptSymbols([{ text: '0042100005264', format: 'UPCE' }], f, 0);
    expect(upca?.kind === 'product' && upca.gtin14).toBe('00036000291452');
    expect(upce?.kind === 'product' && upce.gtin14).toBe('00042100005264');
    expect(upce?.format).toBe('UPC-E');
  });

  it('drops bad check digits and formats outside the four', () => {
    const f = single();
    expect(acceptSymbols([{ text: '3017620422004', format: 'EAN13' }], f, 0)).toEqual([]);
    expect(acceptSymbols([{ text: 'HELLO', format: 'QRCode' }], f, 0)).toEqual([]);
    expect(acceptSymbols([{ text: '3017620422003', format: 'Code128' }], f, 0)).toEqual([]);
  });

  it('de-duplicates the UPC-A and EAN-13 reads of one pack', () => {
    const f = single();
    expect(acceptSymbols([{ text: '036000291452', format: 'UPCA' }], f, 0)).toHaveLength(1);
    expect(acceptSymbols([{ text: '0036000291452', format: 'EAN13' }], f, 100)).toEqual([]);
  });

  it('passes in-store codes through, keyed apart from products', () => {
    const f = single();
    const [code] = acceptSymbols([{ text: '0212345001509', format: 'EAN13' }], f, 0);
    expect(code).toEqual({ kind: 'variable-measure', format: 'EAN-13', digits: '0212345001509' });
    expect(code && dedupeKey(code)).toBe('store:0212345001509');
  });

  it('waits for a second matching read by default', () => {
    const f = createDuplicateFilter();
    const symbols = [{ text: '3017620422003', format: 'EAN13' }];
    expect(acceptSymbols(symbols, f, 0)).toEqual([]);
    expect(acceptSymbols(symbols, f, 100)).toHaveLength(1);
  });
});

describe('FrameGate', () => {
  it('keeps one decode in flight', () => {
    const g = new FrameGate({ minIntervalMs: 0 });
    const id = g.tryCapture(0);
    expect(id).not.toBeNull();
    expect(g.tryCapture(10)).toBeNull();
    expect(g.settle(id ?? -1)).toBe(true);
    expect(g.tryCapture(20)).not.toBeNull();
  });

  it('caps the capture rate', () => {
    const g = new FrameGate({ minIntervalMs: 100 });
    const a = g.tryCapture(0);
    g.settle(a ?? -1);
    expect(g.tryCapture(50)).toBeNull();
    expect(g.tryCapture(100)).not.toBeNull();
  });

  it('absorbs a 30 fps camera into about 10 decodes per second with a fast worker', () => {
    const g = new FrameGate({ minIntervalMs: 100 });
    let captures = 0;
    for (let t = 0; t < 1000; t += 1000 / 30) {
      const id = g.tryCapture(t);
      if (id !== null) {
        captures++;
        g.settle(id);
      }
    }
    expect(captures).toBe(10);
  });

  it('follows a slow worker instead of queueing frames', () => {
    const g = new FrameGate({ minIntervalMs: 100 });
    let pending: { id: number; doneAt: number } | null = null;
    let captures = 0;
    for (let t = 0; t < 1000; t += 1000 / 30) {
      if (pending && t >= pending.doneAt) {
        g.settle(pending.id);
        pending = null;
      }
      const id = g.tryCapture(t);
      if (id !== null) {
        captures++;
        pending = { id, doneAt: t + 250 };
      }
    }
    expect(captures).toBe(4);
  });

  it('abandons a decode that never answers, and ignores its late reply', () => {
    const g = new FrameGate({ minIntervalMs: 0, timeoutMs: 2000 });
    const lost = g.tryCapture(0);
    expect(g.tryCapture(1999)).toBeNull();
    const next = g.tryCapture(2000);
    expect(next).not.toBeNull();
    expect(g.settle(lost ?? -1)).toBe(false);
    expect(g.settle(next ?? -1)).toBe(true);
  });
});

describe('createLowLightMonitor', () => {
  it('raises the hint after 2 s of dark frames without a decode', () => {
    const m = createLowLightMonitor({ threshold: 40 });
    expect(m.frame(10, false, 0)).toBe(false);
    expect(m.frame(10, false, 1999)).toBe(false);
    expect(m.frame(10, false, 2000)).toBe(true);
  });

  it('clears on a decode or clearly brighter frames, not on a flicker at the threshold', () => {
    const m = createLowLightMonitor({ threshold: 40 });
    m.frame(10, false, 0);
    m.frame(10, false, 2000);
    expect(m.frame(42, false, 2100)).toBe(true);
    expect(m.frame(60, false, 2200)).toBe(false);
    m.frame(10, false, 3000);
    m.frame(10, false, 5000);
    expect(m.frame(10, true, 5100)).toBe(false);
  });

  it('restarts the 2 s count after a bright frame', () => {
    const m = createLowLightMonitor({ threshold: 40 });
    m.frame(10, false, 0);
    m.frame(80, false, 1500);
    expect(m.frame(10, false, 2500)).toBe(false);
    expect(m.frame(10, false, 4500)).toBe(true);
  });
});

describe('meanLuma', () => {
  it('measures black, white and grey frames', () => {
    const px = (v: number, n: number) => new Uint8ClampedArray(n * 4).fill(v);
    expect(meanLuma(px(0, 64))).toBe(0);
    expect(meanLuma(px(255, 64))).toBeCloseTo(255, 5);
    expect(meanLuma(px(128, 64), 1)).toBeCloseTo(128, 5);
    expect(meanLuma(new Uint8ClampedArray(0))).toBe(0);
  });
});

const errorsFixture = [
  ['NotAllowedError', 'permission-denied'],
  ['SecurityError', 'permission-denied'],
  ['NotFoundError', 'no-camera'],
  ['NotReadableError', 'camera-unavailable'],
  ['OverconstrainedError', 'camera-unavailable'],
  ['AbortError', 'camera-unavailable'],
] as const;

describe('scanner errors', () => {
  it.each(errorsFixture)('maps %s to %s', (name, code) => {
    expect(toScannerError({ name }).code).toBe(code);
  });

  it('checks the context before asking for the camera', () => {
    expect(preflightError({ isSecureContext: false, hasGetUserMedia: true })?.code).toBe('insecure-context');
    expect(preflightError({ isSecureContext: true, hasGetUserMedia: false })?.code).toBe('no-camera');
    expect(preflightError({ isSecureContext: true, hasGetUserMedia: true })).toBeNull();
  });
});
