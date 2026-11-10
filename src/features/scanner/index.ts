export type { ScannedCode } from '@/shared/lib/gtin';
export { isCameraPrimed, markCameraPrimed, primeCamera } from './model/camera';
export type { ScannerError, ScannerErrorCode } from './model/errors';
export type { AimSpec, Rect } from './model/geometry';
export { aimWindowRect, DEFAULT_AIM } from './model/geometry';
export type { ScannerController, ScannerState, ScannerStatus, UseScannerOptions } from './model/useScanner';
export { useScanner } from './model/useScanner';
export type { AimRenderProps, ScannerViewportHandle, ScannerViewportProps } from './ui/ScannerViewport';
export { ScannerViewport } from './ui/ScannerViewport';
