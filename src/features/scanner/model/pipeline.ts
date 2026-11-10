import { type GtinFormat, parseBarcode, type ScannedCode } from '@/shared/lib/gtin';
import type { DuplicateFilter } from './dedupe';
import type { DecodedSymbol } from './protocol';

const FORMATS: Record<string, GtinFormat> = {
  EAN13: 'EAN-13',
  'EAN-13': 'EAN-13',
  EAN8: 'EAN-8',
  'EAN-8': 'EAN-8',
  UPCA: 'UPC-A',
  'UPC-A': 'UPC-A',
  UPCE: 'UPC-E',
  'UPC-E': 'UPC-E',
};

export function dedupeKey(code: ScannedCode): string {
  return code.kind === 'product' ? code.gtin14 : `store:${code.digits}`;
}

/** Decoder output → codes to emit: unknown formats and bad check digits are dropped silently, then duplicates. */
export function acceptSymbols(symbols: readonly DecodedSymbol[], filter: DuplicateFilter, now: number): ScannedCode[] {
  const out: ScannedCode[] = [];
  for (const symbol of symbols) {
    const format = FORMATS[symbol.format];
    if (!format) continue;
    const parsed = parseBarcode(symbol.text, format);
    if (!parsed.ok) continue;
    if (filter.accept(dedupeKey(parsed.code), now)) out.push(parsed.code);
  }
  return out;
}

export interface FrameGateOptions {
  /** Minimum time between two captures (ms). 100 ms ≈ 10 decodes per second at most. */
  minIntervalMs?: number;
  /** A decode that has not answered after this long is abandoned. */
  timeoutMs?: number;
}

/** One decode in flight, frames dropped while the worker is busy, capped rate. */
export class FrameGate {
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private lastCaptureAt = Number.NEGATIVE_INFINITY;
  private inFlight: { id: number; at: number } | null = null;
  private nextId = 1;

  constructor({ minIntervalMs = 100, timeoutMs = 2000 }: FrameGateOptions = {}) {
    this.minIntervalMs = minIntervalMs;
    this.timeoutMs = timeoutMs;
  }

  /** Returns a request id when a frame should be captured now, otherwise null. */
  tryCapture(now: number): number | null {
    if (this.inFlight && now - this.inFlight.at < this.timeoutMs) return null;
    if (now - this.lastCaptureAt < this.minIntervalMs) return null;
    const id = this.nextId++;
    this.inFlight = { id, at: now };
    this.lastCaptureAt = now;
    return id;
  }

  /** Marks a request as answered (or failed before it was sent). Stale ids are ignored. */
  settle(id: number): boolean {
    if (this.inFlight?.id !== id) return false;
    this.inFlight = null;
    return true;
  }

  reset(): void {
    this.inFlight = null;
    this.lastCaptureAt = Number.NEGATIVE_INFINITY;
  }
}
