import { preflightError, type ScannerError, toScannerError } from './errors';

/**
 * Rear camera, 1080p ideal: enough for EAN-13 at arm's length once cropped to the aim window.
 * Only `ideal` values, so no OverconstrainedError on older iPhones.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export type CameraResult = { ok: true; stream: MediaStream } | { ok: false; error: ScannerError };

export async function openCamera(): Promise<CameraResult> {
  const preflight = preflightError({
    isSecureContext: globalThis.isSecureContext === true,
    hasGetUserMedia: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
  });
  if (preflight) return { ok: false, error: preflight };
  try {
    return { ok: true, stream: await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS) };
  } catch (error) {
    return { ok: false, error: toScannerError(error) };
  }
}

export function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

// First-run camera primer (design 03 §4.1.9): a per-device flag, set once the camera has been granted from the
// primer. This module is its single source of truth: the scan flow reads and sets it, primeCamera() obeys it.
const CAMERA_PRIMED_KEY = 'cellier.camera.primed';
let cameraPrimedCache: boolean | null = null;

/** True once the user has passed the camera permission primer on this device. */
export function isCameraPrimed(): boolean {
  if (cameraPrimedCache === null) {
    try {
      cameraPrimedCache = globalThis.localStorage?.getItem(CAMERA_PRIMED_KEY) === '1';
    } catch {
      cameraPrimedCache = false;
    }
  }
  return cameraPrimedCache;
}

/** Called by the scan flow once the camera has been granted from the primer. */
export function markCameraPrimed(): void {
  cameraPrimedCache = true;
  try {
    globalThis.localStorage?.setItem(CAMERA_PRIMED_KEY, '1');
  } catch {
    // Blocked storage: the flag lives for this session only.
  }
}

// A stream requested from a gesture outside the viewport (scan button, primer), adopted by the next useScanner.
const PRIMED_TTL_MS = 10_000;
let primed: { promise: Promise<CameraResult>; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Call synchronously inside the tap / pointerup handler that opens the scanner, before it mounts.
 * The camera request then carries the user activation; the mounted scanner adopts the stream.
 * Does nothing until the first-run primer has been passed: the primer's own button opens the camera.
 */
export function primeCamera(): void {
  if (!isCameraPrimed()) return;
  if (primed) return;
  const promise = openCamera();
  const timer = setTimeout(() => {
    if (primed?.promise !== promise) return;
    primed = null;
    void promise.then((r) => r.ok && stopStream(r.stream));
  }, PRIMED_TTL_MS);
  primed = { promise, timer };
}

export function takePrimedCamera(): Promise<CameraResult> | null {
  if (!primed) return null;
  clearTimeout(primed.timer);
  const { promise } = primed;
  primed = null;
  return promise;
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

/** Torch is offered only when the track says so; advanced constraints fail silently otherwise. */
export function trackSupportsTorch(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  return (track.getCapabilities() as TorchCapabilities).torch === true;
}

/** Never read torch state back from getSettings(): it is stale on iOS 18 (WebKit 280970). */
export async function applyTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}
