import { type RefCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ScannedCode } from '@/shared/lib/gtin';
import { type EngineConfig, ScannerEngine, type ScannerState } from './engine';
import type { ScannerError } from './errors';
import type { AimSpec } from './geometry';

export type { ScannerState, ScannerStatus } from './engine';

export interface UseScannerOptions {
  /** Valid, de-duplicated code. Products and in-store codes both arrive here: check `kind`. */
  onDetect: (code: ScannedCode) => void;
  onError?: (error: ScannerError) => void;
  /** Stops decoding (an overlay is open) while the camera keeps running. */
  paused?: boolean;
  /**
   * Request the camera on mount, without a gesture. Off by default: call start() or primeCamera()
   * from a tap. A stream primed by primeCamera() is always adopted on mount.
   */
  autoStart?: boolean;
  aim?: AimSpec;
  /** Read once on mount. */
  repeatMs?: number;
  clearMs?: number;
}

export interface ScannerController extends ScannerState {
  /** Attach to the `<video playsInline muted autoPlay>` element. */
  videoRef: RefCallback<HTMLVideoElement>;
  /** Call from a user gesture (click / pointerup): getUserMedia runs synchronously inside it. */
  start: () => Promise<void>;
  stop: () => void;
  /** Resolves false, and reports torch as unsupported, when the track refuses it. */
  setTorch: (on: boolean) => Promise<boolean>;
}

export function useScanner(options: UseScannerOptions): ScannerController {
  const configRef = useRef<EngineConfig>(options);
  useLayoutEffect(() => {
    configRef.current = options;
  });

  const [engine] = useState(
    () =>
      new ScannerEngine(() => configRef.current, {
        ...(options.repeatMs !== undefined && { repeatMs: options.repeatMs }),
        ...(options.clearMs !== undefined && { clearMs: options.clearMs }),
      }),
  );
  const [autoStart] = useState(options.autoStart === true);

  useEffect(() => {
    engine.mount(autoStart);
    return () => engine.unmount();
  }, [engine, autoStart]);

  const paused = options.paused === true;
  useEffect(() => {
    engine.setPaused(paused);
  }, [engine, paused]);

  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const [videoRef] = useState<RefCallback<HTMLVideoElement>>(
    () => (el: HTMLVideoElement | null) => engine.setVideo(el),
  );

  return { ...state, videoRef, start: engine.start, stop: engine.stop, setTorch: engine.setTorch };
}
