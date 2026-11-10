import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { meanLuma } from './luma';
import { DECODE_FORMATS, type WorkerRequest, type WorkerResponse } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

// Same-origin wasm: the default locateFile points at a CDN, which the CSP blocks.
const overrides = {
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? new URL(wasmUrl, self.location.href).href : prefix + path,
};
prepareZXingModule({ overrides });

const readerOptions = {
  formats: [...DECODE_FORMATS],
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

async function init(): Promise<void> {
  try {
    await prepareZXingModule({ overrides, fireImmediately: true });
    scope.postMessage({ type: 'ready' });
  } catch (error) {
    scope.postMessage({ type: 'init-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

async function decode(id: number, width: number, height: number, pixels: ArrayBuffer): Promise<void> {
  const started = performance.now();
  const data = new Uint8ClampedArray(pixels);
  const luma = meanLuma(data);
  let symbols: { text: string; format: string }[] = [];
  try {
    const results = await readBarcodes(new ImageData(data, width, height), readerOptions);
    symbols = results.filter((r) => r.isValid).map((r) => ({ text: r.text, format: r.format }));
  } catch {
    // A failed frame is a frame without a code.
  }
  scope.postMessage({ type: 'result', id, symbols, luma, ms: performance.now() - started });
}

scope.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') void init();
  else if (msg.type === 'decode') void decode(msg.id, msg.width, msg.height, msg.pixels);
});
