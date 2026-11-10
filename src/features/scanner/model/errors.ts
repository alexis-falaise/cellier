export type ScannerErrorCode =
  | 'permission-denied'
  | 'no-camera'
  | 'insecure-context'
  | 'camera-unavailable'
  | 'stream-ended'
  | 'decoder-failed';

export interface ScannerError {
  code: ScannerErrorCode;
  /** Underlying DOMException name or message, for logs only. */
  detail?: string;
}

/** Checked before calling getUserMedia: an http page or a missing mediaDevices never prompts. */
export function preflightError(env: { isSecureContext: boolean; hasGetUserMedia: boolean }): ScannerError | null {
  if (!env.isSecureContext) return { code: 'insecure-context' };
  if (!env.hasGetUserMedia) return { code: 'no-camera', detail: 'mediaDevices.getUserMedia missing' };
  return null;
}

/** Maps a getUserMedia / play() rejection to a scanner error. */
export function toScannerError(error: unknown): ScannerError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { code: 'permission-denied', detail: name };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { code: 'no-camera', detail: name };
    default:
      return { code: 'camera-unavailable', detail: name || String(error) };
  }
}
