import { type CSSProperties, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ScannedCode } from '@/shared/lib/gtin';
import type { ScannerError } from '../model/errors';
import { type AimSpec, aimWindowRect, DEFAULT_AIM, type Rect } from '../model/geometry';
import { type ScannerState, useScanner } from '../model/useScanner';

export interface ScannerViewportHandle {
  /** Call from the gesture that should open the camera (click / pointerup). */
  start: () => Promise<void>;
  stop: () => void;
  setTorch: (on: boolean) => Promise<boolean>;
}

export interface AimRenderProps {
  /** Aim window in the viewport's CSS pixels. */
  rect: Rect;
  /** Incremented on every accepted code: key the reticle's success impulse on it. */
  detections: number;
  state: ScannerState;
}

export interface ScannerViewportProps {
  onDetect: (code: ScannedCode) => void;
  onError?: (error: ScannerError) => void;
  onStateChange?: (state: ScannerState) => void;
  /** Decoding stops while true (an overlay is open); the camera stays on. */
  paused?: boolean;
  autoStart?: boolean;
  aim?: AimSpec;
  /** Rendered inside the aim window (the reticle). */
  children?: ReactNode | ((props: AimRenderProps) => ReactNode);
  className?: string;
  ref?: Ref<ScannerViewportHandle>;
}

const rootStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: '#000',
};
const videoStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };

/**
 * Camera feed and aim window. No chrome: the cover draws the mask, top bar, hint and tray.
 * The aim window is also published as CSS variables (--aim-x, --aim-y, --aim-w, --aim-h) on the root.
 */
export function ScannerViewport({
  onDetect,
  onError,
  onStateChange,
  paused = false,
  autoStart = false,
  aim = DEFAULT_AIM,
  children,
  className,
  ref,
}: ScannerViewportProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [detections, setDetections] = useState(0);

  const scanner = useScanner({
    onDetect: (code) => {
      onDetect(code);
      setDetections((n) => n + 1);
    },
    ...(onError && { onError }),
    paused,
    autoStart,
    aim,
  });
  const { start, stop, setTorch, status, error, torch, lowLight } = scanner;

  useImperativeHandle(ref, () => ({ start, stop, setTorch }), [start, stop, setTorch]);

  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.({ status, error, torch: { supported: torch.supported, on: torch.on }, lowLight });
  }, [status, error, torch.supported, torch.on, lowLight]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rect = size ? aimWindowRect(size, aim) : null;
  const style: CSSProperties = rect
    ? ({
        ...rootStyle,
        '--aim-x': `${rect.x}px`,
        '--aim-y': `${rect.y}px`,
        '--aim-w': `${rect.width}px`,
        '--aim-h': `${rect.height}px`,
      } as CSSProperties)
    : rootStyle;

  return (
    <div ref={rootRef} className={className} style={style} data-status={status}>
      <video ref={scanner.videoRef} style={videoStyle} playsInline muted autoPlay disablePictureInPicture />
      {rect && children != null && (
        <div
          style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          data-aim-window=""
        >
          {typeof children === 'function'
            ? children({ rect, detections, state: { status, error, torch, lowLight } })
            : children}
        </div>
      )}
    </div>
  );
}
