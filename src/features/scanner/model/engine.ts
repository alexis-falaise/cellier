import type { ScannedCode } from '@/shared/lib/gtin';
import { applyTorch, type CameraResult, openCamera, stopStream, takePrimedCamera, trackSupportsTorch } from './camera';
import { createDuplicateFilter, type DuplicateFilter, type DuplicateFilterOptions } from './dedupe';
import type { ScannerError } from './errors';
import { type AimSpec, aimWindowRect, DEFAULT_AIM, decodeSize, viewportRectToSource } from './geometry';
import { createLowLightMonitor, type LowLightMonitor } from './lowLight';
import { acceptSymbols, FrameGate } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';

export type ScannerStatus = 'idle' | 'starting' | 'live' | 'paused' | 'error';

export interface ScannerState {
  status: ScannerStatus;
  error: ScannerError | null;
  torch: { supported: boolean; on: boolean };
  /** Dark frames for 2 s without a decode (design 4.4.1, LowLightHint). */
  lowLight: boolean;
}

export interface EngineConfig {
  onDetect: (code: ScannedCode) => void;
  onError?: ((error: ScannerError) => void) | undefined;
  aim?: AimSpec | undefined;
}

export interface EngineOptions extends DuplicateFilterOptions {
  createWorker?: () => Worker;
}

// CSS px added around the aim window: a code slightly outside the reticle still decodes.
const AIM_PADDING = 16;
// Long side of the bitmap sent to the worker.
const MAX_DECODE_SIDE = 1280;
// Capture attempts; the FrameGate keeps decodes to one in flight and at most 10 per second.
const TICK_MS = 33;

const INITIAL: ScannerState = { status: 'idle', error: null, torch: { supported: false, on: false }, lowLight: false };

/** Module worker running the zxing-wasm reader; Vite bundles it and its wasm as same-origin assets. */
export function createDecodeWorker(): Worker {
  return new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module', name: 'barcode' });
}

/** Camera, frame loop and decoder worker, outside React. One engine per mounted viewport. */
export class ScannerEngine {
  private state: ScannerState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly gate = new FrameGate();
  private readonly filter: DuplicateFilter;
  private readonly lowLight: LowLightMonitor = createLowLightMonitor();
  private readonly createWorker: () => Worker;

  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mounted = false;
  private starting = false;
  private paused = false;
  private torchWanted = false;
  private loop: { cancel: () => void } | null = null;

  constructor(
    private readonly config: () => EngineConfig,
    options: EngineOptions = {},
  ) {
    const { createWorker, ...filterOptions } = options;
    this.filter = createDuplicateFilter(filterOptions);
    this.createWorker = createWorker ?? createDecodeWorker;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): ScannerState => this.state;

  setVideo(video: HTMLVideoElement | null): void {
    if (this.video === video) return;
    this.loop?.cancel();
    this.loop = null;
    this.video = video;
    this.syncLoop();
  }

  mount(autoStart: boolean): void {
    this.mounted = true;
    const worker = this.createWorker();
    worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => this.onWorkerMessage(e.data));
    worker.addEventListener('error', (e) => this.fail({ code: 'decoder-failed', detail: e.message }));
    const init: WorkerRequest = { type: 'init' };
    worker.postMessage(init);
    this.worker = worker;
    document.addEventListener('visibilitychange', this.onVisibility);

    const primed = takePrimedCamera();
    if (primed) void this.begin(primed);
    else if (autoStart) void this.start();
  }

  unmount(): void {
    this.mounted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.teardownStream();
    this.worker?.terminate();
    this.worker = null;
  }

  /** Call from a user gesture: getUserMedia runs before the first await. */
  readonly start = (): Promise<void> => {
    if (this.starting || this.stream) return Promise.resolve();
    return this.begin(takePrimedCamera() ?? openCamera());
  };

  readonly stop = (): void => {
    this.torchWanted = false;
    this.teardownStream();
    this.patch({ status: 'idle', error: null });
  };

  readonly setTorch = async (on: boolean): Promise<boolean> => {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !trackSupportsTorch(track)) return false;
    const ok = await applyTorch(track, on);
    if (ok) this.torchWanted = on;
    this.patch({ torch: ok ? { supported: true, on } : { supported: false, on: false } });
    return ok;
  };

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncLoop();
  }

  private patch(next: Partial<ScannerState>): void {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
    if ('status' in next) this.syncLoop();
  }

  private fail(error: ScannerError): void {
    this.teardownStream();
    this.patch({ status: 'error', error });
    this.config().onError?.(error);
  }

  private async begin(pending: Promise<CameraResult>): Promise<void> {
    this.starting = true;
    this.patch({ status: 'starting', error: null });
    try {
      const result = await pending;
      if (!this.mounted) {
        if (result.ok) stopStream(result.stream);
        return;
      }
      if (!result.ok) this.fail(result.error);
      else await this.attach(result.stream);
    } finally {
      this.starting = false;
    }
  }

  private async attach(stream: MediaStream): Promise<void> {
    const video = this.video;
    if (!video) {
      stopStream(stream);
      this.fail({ code: 'camera-unavailable', detail: 'no video element' });
      return;
    }
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      // stop() never fires 'ended': iOS or another app took the camera. Hidden: reopened on return.
      if (this.stream === stream && document.visibilityState === 'visible') this.fail({ code: 'stream-ended' });
    });
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      if (this.stream !== stream) return; // replaced or torn down meanwhile
      this.fail({ code: 'camera-unavailable', detail: err instanceof Error ? err.name : String(err) });
      return;
    }
    if (this.stream !== stream) return;
    const supported = trackSupportsTorch(track);
    const on = supported && this.torchWanted && track ? await applyTorch(track, true) : false;
    this.patch({
      status: document.visibilityState === 'hidden' ? 'paused' : 'live',
      error: null,
      torch: { supported, on },
    });
  }

  private teardownStream(): void {
    const stream = this.stream;
    this.stream = null;
    stopStream(stream);
    if (this.video) this.video.srcObject = null;
    this.gate.reset();
    this.lowLight.reset();
    if (this.state.lowLight || this.state.torch.on) {
      this.patch({ lowLight: false, torch: { supported: this.state.torch.supported, on: false } });
    }
  }

  private readonly onVisibility = (): void => {
    const stream = this.stream;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (document.visibilityState === 'hidden') {
      if (track) track.enabled = false;
      this.patch({ status: 'paused' });
      return;
    }
    if (!track || track.readyState === 'ended') {
      this.teardownStream();
      void this.begin(openCamera());
      return;
    }
    track.enabled = true;
    void this.video?.play().catch(() => undefined);
    if (this.torchWanted && trackSupportsTorch(track)) void applyTorch(track, true);
    this.patch({ status: 'live' });
  };

  private syncLoop(): void {
    const shouldRun = this.state.status === 'live' && !this.paused && this.video !== null;
    if (shouldRun && !this.loop) this.loop = this.runLoop();
    else if (!shouldRun && this.loop) {
      this.loop.cancel();
      this.loop = null;
      this.gate.reset();
    }
  }

  /**
   * A plain timer, not requestVideoFrameCallback: rVFC silently stops firing whenever the browser stops presenting
   * the video, and nothing restarted it, so the scanner could go deaf after a code until it was reopened. drawImage
   * always reads the latest frame, so a timer loses nothing.
   */
  private runLoop(): { cancel: () => void } {
    const video = this.video as HTMLVideoElement;
    const timer = setInterval(() => {
      // iOS can pause a live <video> on its own (interruption, layer change): resume it instead of reading a still.
      if (video.paused && this.stream && document.visibilityState === 'visible')
        void video.play().catch(() => undefined);
      this.captureFrame(video);
    }, TICK_MS);
    return { cancel: () => clearInterval(timer) };
  }

  private captureFrame(video: HTMLVideoElement): void {
    const worker = this.worker;
    if (!worker || video.readyState < 2 || video.videoWidth === 0) return;
    const viewport = { width: video.clientWidth, height: video.clientHeight };
    const aim = aimWindowRect(viewport, this.config().aim ?? DEFAULT_AIM);
    const source = viewportRectToSource(
      viewport,
      { width: video.videoWidth, height: video.videoHeight },
      aim,
      AIM_PADDING,
    );
    if (!source) return;
    const id = this.gate.tryCapture(performance.now());
    if (id === null) return;
    try {
      const out = decodeSize(source, MAX_DECODE_SIDE);
      this.canvas ??= document.createElement('canvas');
      const canvas = this.canvas;
      if (canvas.width !== out.width) canvas.width = out.width;
      if (canvas.height !== out.height) canvas.height = out.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2d context');
      ctx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, out.width, out.height);
      const pixels = ctx.getImageData(0, 0, out.width, out.height).data.buffer;
      const req: WorkerRequest = { type: 'decode', id, width: out.width, height: out.height, pixels };
      worker.postMessage(req, [pixels]);
    } catch {
      this.gate.settle(id);
    }
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    if (msg.type === 'init-failed') {
      this.fail({ code: 'decoder-failed', detail: msg.message });
      return;
    }
    if (msg.type !== 'result' || !this.gate.settle(msg.id)) return;
    if (this.paused || !this.stream) return;
    const now = performance.now();
    const low = this.lowLight.frame(msg.luma, msg.symbols.length > 0, now);
    if (low !== this.state.lowLight) this.patch({ lowLight: low });
    for (const code of acceptSymbols(msg.symbols, this.filter, now)) this.config().onDetect(code);
  }
}
