/**
 * Hybrid logical clock (research/15 §6.2, 02 §6): `${wall ms, 15 digits}.${counter, 6 digits}.${deviceId}`.
 * Lexicographic order equals HLC order, which the server relies on (`private.hlc_wins`).
 */
import type { DeviceId, Hlc, IsoDateTime } from '@/domain/types';
import type { HybridClock } from './contract';

const HLC_RE = /^(\d{15})\.(\d{6})\.(.+)$/;
const MAX_COUNTER = 999_999;

export interface ParsedHlc {
  wall: number;
  counter: number;
  deviceId: string;
}

export function parseHlc(hlc: string): ParsedHlc | null {
  const m = HLC_RE.exec(hlc);
  if (!m) return null;
  return { wall: Number(m[1]), counter: Number(m[2]), deviceId: m[3] ?? '' };
}

export function formatHlc(wall: number, counter: number, deviceId: string): Hlc {
  return `${String(wall).padStart(15, '0')}.${String(counter).padStart(6, '0')}.${deviceId}` as Hlc;
}

/** Device id that wrote an HLC (used to show «Modification remplacée» to the right device). */
export function hlcDeviceId(hlc: string): string | null {
  return parseHlc(hlc)?.deviceId ?? null;
}

export interface ClockOptions {
  deviceId: DeviceId;
  /** Last persisted HLC (`meta.device.hlc`), if any. */
  initial?: Hlc | null;
  now?: () => number;
  /** Called after the state changed; the engine persists at most once per second. */
  onChange?: (hlc: Hlc) => void;
}

export interface PersistableClock extends HybridClock {
  /** Last timestamp issued or observed. */
  current(): Hlc;
}

export function createHybridClock(options: ClockOptions): PersistableClock {
  const now = options.now ?? Date.now;
  const parsed = options.initial ? parseHlc(options.initial) : null;
  let wall = parsed?.wall ?? 0;
  let counter = parsed?.counter ?? 0;
  let skewMs = 0;

  const emit = () => options.onChange?.(formatHlc(wall, counter, options.deviceId));

  function advance(remoteWall: number, remoteCounter: number): void {
    const physical = now();
    const nextWall = Math.max(wall, remoteWall, physical);
    if (nextWall === wall && nextWall === remoteWall) counter = Math.max(counter, remoteCounter) + 1;
    else if (nextWall === wall) counter += 1;
    else if (nextWall === remoteWall) counter = remoteCounter + 1;
    else counter = 0;
    wall = nextWall;
    if (counter > MAX_COUNTER) {
      wall += 1;
      counter = 0;
    }
  }

  return {
    next() {
      const physical = now();
      if (physical > wall) {
        wall = physical;
        counter = 0;
      } else {
        counter += 1;
        if (counter > MAX_COUNTER) {
          wall += 1;
          counter = 0;
        }
      }
      emit();
      return formatHlc(wall, counter, options.deviceId);
    },
    observe(remote: Hlc | IsoDateTime) {
      const asHlc = parseHlc(remote);
      if (asHlc) {
        advance(asHlc.wall, asHlc.counter);
      } else {
        const t = Date.parse(remote);
        if (Number.isNaN(t)) return;
        skewMs = now() - t;
        advance(t, -1);
      }
      emit();
    },
    get skewMs() {
      return skewMs;
    },
    current() {
      return formatHlc(wall, counter, options.deviceId);
    },
  };
}
