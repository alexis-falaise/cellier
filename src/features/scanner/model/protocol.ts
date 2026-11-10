/** zxing-wasm format names the worker is limited to. */
export const DECODE_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE'] as const;
export type DecodeFormat = (typeof DECODE_FORMATS)[number];

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'decode'; id: number; width: number; height: number; pixels: ArrayBuffer };

export interface DecodedSymbol {
  text: string;
  format: string;
}

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'init-failed'; message: string }
  | {
      type: 'result';
      id: number;
      symbols: DecodedSymbol[];
      /** Mean luma of the crop, 0–255, for the low-light hint. */
      luma: number;
      ms: number;
    };
