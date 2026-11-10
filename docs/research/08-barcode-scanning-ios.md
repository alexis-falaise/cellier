# 08 - Barcode scanning in iOS Safari and standalone PWAs

Scope: Cellier, iOS-first PWA (Vite + React + TypeScript) on iPhone 13 to 15 Pro, scanning EAN-13 / EAN-8 / UPC-A in dim light.
Research date: 2026-11-10. Sources are primary where found (WebKit Bugzilla, Apple Developer Forums, caniuse, vendor READMEs, npm/GitHub). Anything not confirmed is marked **UNVERIFIED**.

---

## 1. Summary

- **Barcode Detection API (`BarcodeDetector`) is not usable on iOS Safari.** It is absent or disabled by default on iOS 17.0 through 26.x. On iOS 18 the flag-based path broke (WebKit bug 281848, still NEW). Do not rely on it. Feature-detect and fall back, or skip it.
- **Recommended stack:** `zxing-wasm` (ZXing-C++ compiled to WASM) running in a **Web Worker**, fed with `ImageBitmap` frames from the `<video>` element via `requestVideoFrameCallback` (rVFC) and cropped to a region of interest. Optionally wrap it with the `barcode-detector` polyfill (MIT, Sec-ant) if you want the standard `BarcodeDetector` interface on browsers that lack it.
- **Why zxing-wasm:** actively maintained, Apache-2.0 underlying ZXing-C++ (wrapper MIT), 1D + 2D, small reader-only build (~1.04 MiB WASM), Promise API, runs in workers. html5-qrcode and @zxing/library are both built on ZXing-JS, which is older and less maintained.
- **Commercial SDKs** (Scanbot, Scandit, STRICH, Dynamsoft) have no permanent free production tier. Use only as a fallback if the open-source stack fails the basement test.
- **iOS gotchas that matter:** rear lens selection (`facingMode: environment` can pick ultra-wide or switch lenses mid-scan), torch read-back is unreliable (`getSettings()` stale), camera permission can be re-prompted in standalone mode, and `playsinline` + `muted` + `autoplay` are mandatory on `<video>`.

---

## 2. Barcode Detection API on iOS Safari

| Source | Finding |
|---|---|
| caniuse, `mdn-api_barcodedetector` (fetched) | iOS Safari: 3.2-16.7 Not supported; **17.0-26.6 "Disabled by default"**; 27.0-27.2 also "Disabled by default" (likely beta data). Page shows global usage as "47.81% + 30.9% = 78.71%" with no breakdown of the two parts. Source: https://caniuse.com/mdn-api_barcodedetector |
| Apple Developer Forums, "Shape Detection API (Barcode Detector) - Safari 18.X", Nov 2024 | Worked on Safari 17.x with the Shape Detection feature flag enabled. Broke on iOS 18.0. Toggling flag and restarting did not help. No Apple-staff reply. Source: https://developer.apple.com/forums/thread/767761 |
| WebKit Bugzilla 281848, "Shape Detection API doesn't work on iOS", filed 2024-10-21, **status NEW** (fetched) | Comments: iOS 18.3-18.5 failures on iPhone 15 (Apr-May 2025); first iOS 26 developer beta on iPhone 12 Pro detected nothing and the flag was off after upgrade (June 2025); a user in July 2026 still reports no QR detection in Safari. Source: https://bugs.webkit.org/show_bug.cgi?id=281848 |
| WebKit Bugzilla 198174, feature request to implement `BarcodeDetector` and `FaceDetector` | Long-standing request (noted in search results). Not verified in detail. https://bugs.webkit.org/show_bug.cgi?id=198174 |
| Safari 26.0 / 26.x release notes | Searched WebKit Safari 26 feature lists; **no mention of Shape Detection or BarcodeDetector found**. **UNVERIFIED** that it is absent from every release note; check https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ and the 26.x posts. |

**Conclusion:** Treat `BarcodeDetector` as unavailable on all target iOS versions (17 through 26). Keep a feature check so the code upgrades automatically if Apple ships it:

```ts
const hasNativeDetector = 'BarcodeDetector' in globalThis;
```

Note: `'BarcodeDetector' in globalThis` only checks the constructor exists. It does not prove detection works. Always validate with a real frame.

---

## 3. Libraries: versions, licences, sizes, decode quality

Version data comes from search snippets and registry mirrors. Run `npm view <pkg> version` before pinning. Items marked UNVERIFIED were not confirmed on the registry.

| Library | Version seen | Licence | Size / runtime | Notes |
|---|---|---|---|---|
| **zxing-wasm** (Sec-ant) | 3.1.3 seen on Socket; a DepScope mirror shows 3.0.3 (likely stale). Latest not confirmed. | MIT wrapper; bundles zxing-cpp (Apache-2.0) and zint (BSD-3-Clause) | WASM: `zxing-wasm/reader` ~1.04 MiB, `full` ~1.46 MiB, `writer` ~636 KiB (from README via GitHub fetch) | Promise API: `readBarcodes(input, options)`. Accepts `Blob`, `File`, `ArrayBuffer`, `Uint8Array`, `ImageData`. Options: `formats`, `tryHarder`, `maxNumberOfSymbols`. WASM loads lazily; `prepareZXingModule({ fireImmediately: true })` preloads. README does not mention workers (we run it in one). Sources: https://github.com/Sec-ant/zxing-wasm , https://socket.dev/npm/package/zxing-wasm/overview/3.1.3 |
| **barcode-detector** (Sec-ant) | 3.x; 3.2.x seen | MIT (README fetched) | Not stated; WASM fetched at runtime. zxing-wasm underneath | Standard `BarcodeDetector` API. Entry points: `barcode-detector/ponyfill` (no globals), `barcode-detector/polyfill` (sets global only if absent), root (both). Formerly `@sec-ant/barcode-detector`; renamed from 2.0.0. Source: https://github.com/Sec-ant/barcode-detector |
| **@zxing/library** / **@zxing/browser** (ZXing-JS) | UNVERIFIED (not searched) | Apache-2.0 (UNVERIFIED) | UNVERIFIED | ZXing-JS is a JS port. Scanbot notes it is no longer maintained. Use only if you need zero WASM. |
| **html5-qrcode** | 2.3.8 (GitHub package.json). Scanbot says no release since April 2023. | Apache-2.0 (UNVERIFIED) | Large UI-oriented bundle | Built on ZXing-JS, so decode accuracy tracks ZXing-JS, not zxing-wasm. Known iOS 17.5.1 PWA camera freeze report (WebKit 275527). Scanbot review: https://scanbot.io/blog/quagga2-vs-html5-qrcode-scanner/ |
| **@ericblade/quagga2** | v1.12.1 per DepScope mirror (UNVERIFIED) | MIT (UNVERIFIED) | UNVERIFIED | 1D only (EAN fine). Scanbot reports problems with inverted and low-contrast codes. Quagga2 is a good 1D fallback to test in dim light, but not the primary choice. https://github.com/ericblade/quagga2 |
| **@undecaf/zbar-wasm** | 0.11.0 (Socket and DepScope agree) | LGPL-2.1 (ZBar; UNVERIFIED for the wrapper) | UNVERIFIED | ZBar is solid for EAN/UPC. 0.10+ has breaking changes vs 0.9. Also ships `@undecaf/barcode-detector-polyfill`. Worth a benchmark against zxing-wasm. https://socket.dev/npm/package/@undecaf/zbar-wasm |
| **Scanbot Web Barcode Scanner SDK** | Commercial | Proprietary | Quote-based | No public price. A marketing page says "starts at $2,500" for simple cases (unconfirmed). Scanbot has been acquired by Apryse (banner on site). Free trial: 7-day license form; without a license, runs 1 minute per session. https://docs.scanbot.io/faq/pricing-and-licensing-model/ |
| **Scandit** | Commercial | Proprietary | Quote-based | Third-party listings: 30-day free SDK trial. Production requires sales quote. |
| **STRICH** | Commercial | Proprietary | Usage-based | Vendor: free 30-day trial. Capterra: from $99 per month (UNVERIFIED), trial requires card. No permanent free tier. https://strich.io/ |
| **Dynamsoft Barcode Reader** | Commercial | Proprietary | Per-feature/year | Official pricing page: barcode scanning "starts from $1,499/year" (Capterra lists $1,249, conflicting). Vendor benchmark claims 84.84% recall vs 67.25% for zxing-wasm 3.1.2 on 7,894 mixed images (vendor-run; not EAN-specific). https://www.dynamsoft.com/barcode-reader/pricing/ |

**Free production tier:** none of the four commercial SDKs have a permanent free production tier. Only trials exist.

### Decode speed and accuracy

- No independent head-to-head benchmark of zxing-wasm vs Quagga2 vs html5-qrcode on EAN-13 was found. **UNVERIFIED / no data.**
- Dynamsoft's vendor benchmark (zxing-wasm 3.1.2 in browser): median decode **74.10 ms** on a mixed dataset, recall 67.25%. Vendor-run, not EAN-only. https://www.dynamsoft.com/codepool/benchmark-barcode-reading-javascript-zxing-wasm-dynamsoft-barcode-reader.html
- **Action:** build a 50 to 100 photo EAN-13 set on an iPhone 13/15 Pro in a dim basement, run each candidate (zxing-wasm reader, zbar-wasm, quagga2) on the same frames, and record decode rate and ms/frame. This is the only number that matters for Cellier.

### Recommendation

**Use `zxing-wasm/reader` directly in a Worker** (not the polyfill), because:
1. Only the reader build is needed (~1.04 MiB vs 1.46 MiB).
2. It is the ZXing-C++ engine, which is more accurate than ZXing-JS for 1D codes in poor light.
3. Its `formats` option lets you restrict to `EAN13`, `EAN8`, `UPCA`, which reduces false positives and work per frame.

Keep `barcode-detector` only if other code needs the standard `BarcodeDetector` interface. It adds a layer and does nothing on iOS unless you use the polyfill path.

**Fallback:** `@undecaf/zbar-wasm` for a second opinion on frames that zxing misses, if the benchmark shows it helps. Commercial SDK only if the benchmark fails the basement test and the budget allows a paid licence (Dynamsoft is the lowest published entry price).

---

## 4. getUserMedia on iOS

### 4.1 Rear main camera

- `facingMode: { ideal: 'environment' }` is the portable starting point.
- **Known problem:** iOS can select the **ultra-wide** lens for `environment`. WebKit bug 253186 (iOS 16.4 beta regression) was marked fixed, but the behaviour is still reported as intended-by-design in some cases. https://bugs.webkit.org/show_bug.cgi?id=253186
- **Known problem:** on iPhone 15 Pro with iOS 18, `facingMode: { exact: 'environment' }` still let iOS switch among wide, ultra-wide and telephoto mid-session. Apple Developer Forums thread: https://developer.apple.com/forums/thread/776460 . Related WebKit bug 262416 (triple-camera auto-switch with cropping): https://bugs.webkit.org/show_bug.cgi?id=262416
- **Workaround to test (UNVERIFIED on iOS 18+):** choose by `deviceId` after an initial permission grant (labels are only readable after permission). Pick the device whose label matches "back camera" and excludes "ultra" and "tele". Lock it with `deviceId: { exact }`. Verify on device; the forum reports did not confirm a fix.
- Best-practice: request 1920x1080 ideal, then read `track.getSettings()` and log the `deviceId`/`label` to confirm which lens is in use.

```ts
const constraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};
```

- **Focus:** `focusMode` is a non-standard constraint on iOS. Its support in Safari is **UNVERIFIED**; do not depend on it. Use `track.getCapabilities?.()` guarded by `'focusMode' in caps`.
- **Resolution:** 1280x720 is enough for EAN-13 at arm's length; 1920x1080 helps small codes but costs decode time. Crop to ROI before decode (section 7).

### 4.2 Torch (flash)

- Standards path: `track.applyConstraints({ advanced: [{ torch: true }] })`. Spec origin is the Image Capture spec, not core Media Capture.
- Search results: WebKit bug 243075 (torch ignored on iOS 15, 2022). Bug 280970 (October 2024): `getSettings()` returns stale or false torch values after `applyConstraints` succeeds, on iOS 18. Earlier iOS reported correct values. https://bugs.webkit.org/show_bug.cgi?id=280970
- **Implementation rule:** track torch state in your own code. Do not read it back. Wrap in try/catch and hide the button if `applyConstraints` throws.
- Exact iOS version where torch became reliable: **UNVERIFIED**. Test on target devices.

```ts
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false; // hide torch UI
  }
}
```

### 4.3 Zoom

- `zoom` in `MediaTrackConstraints` is gated on iOS. WebKit's own discussion (bug 253186 thread) states that Safari does not expose lens zoom settings to the page, and virtual cameras use the smallest zoom. Treat zoom as **unavailable** and use digital crop plus lens choice instead. **UNVERIFIED** on iOS 26.

---

## 5. Camera permission in standalone PWAs

- Symptom reports: repeated camera permission prompts on every launch of a home-screen web app, and permission lost when the hash or `history.pushState` changes. Sources: WebKit bug 215884 (hash change revokes in standalone mode), bug 212040 (pushState mutes camera stream), Apple Developer Forums "Repeated Camera Permission Prompts in Web App on Safari (iOS)": https://developer.apple.com/forums/thread/788518
- Bug 275527 (iOS 17.5.1): camera freezes in installed PWA; many html5-qrcode users affected. https://lists.webkit.org/pipermail/webkit-unassigned/2024-June/1170250.html
- **Current status on iOS 18 to 26:** **UNVERIFIED**. The bug status was not checked beyond the snippets.
- **Practical mitigations:**
  - Ask for camera in a user gesture (button tap) on the scanner screen, not on app launch.
  - Do not use hash routing that changes during scanning; keep the `<video>` mounted across navigation.
  - Release tracks on unmount (`track.stop()`), and re-request only on explicit user action.
  - Handle `NotAllowedError` and show a "Open Settings > Safari > Camera" hint.
  - Test: install to home screen, revoke, relaunch, scan. Document results.

### Video element requirements

```html
<video playsinline muted autoplay></video>
```

- `playsinline` is required, otherwise iOS fullscreens the video.
- `muted` is needed for autoplay, and `video.play()` must follow a user gesture on first start.
- Set `srcObject` (not `src`), then `await video.play()` and catch rejection.

---

## 6. Off-main-thread decoding

- **requestVideoFrameCallback:** supported in Safari since 15.4 (web.dev browser support and web-features data). Use it to get one callback per decoded frame. Fallback: `requestAnimationFrame` with `video.readyState >= 2` check. Sources: https://web.dev/articles/requestvideoframecallback-rvfc , https://web-platform-dx.github.io/web-features-explorer/features/request-video-frame-callback
- **OffscreenCanvas:** 2D context shipped in Safari 16.4. WebGL in workers is inconsistent: reports say it depends on macOS version (Ventura vs Sonoma) for Safari 17.1. We use 2D only, so this does not matter. Feature-detect inside the worker. Source (search summary): https://bugs.webkit.org/show_bug.cgi?id=263010
- **createImageBitmap(video, ...)** plus **transfer** to the Worker avoids copying pixels. Draw into an `OffscreenCanvas` in the worker and call `getImageData`.
- **Throttle:** keep one decode in flight. Drop frames while the worker is busy. Target 8 to 12 decodes per second; the video can run at 30 fps.

---

## 7. ROI crop, throttling, debouncing, checksum

- **ROI:** a centred band (for example 90% width x 45% height) matches the laser-line shape of a 1D code. Crop before decoding; smaller frames decode faster.
- **Duplicate debouncing:** remember `(code, timestamp)`. Ignore the same code for 1500 ms. For batch logging, also require the code to leave the frame for at least 300 ms before accepting it again, so a single item is not logged twice.
- **Checksum:** zxing validates EAN/UPC check digits. Add a JS check as defence in depth, cheap and independent of the library.

```ts
export function eanChecksumOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // EAN weights: alternate 3,1 starting from the right of the data part
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
```

UPC-A (12 digits) uses the same algorithm. EAN-13 and UPC-A both pass when the leading zero is added. Accept 8, 12 and 13 digit codes.

---

## 8. Continuous scanning for logging many items

- Keep the camera and worker alive across scans. Do not stop tracks between items.
- Emit each accepted code via `onScan`, then enter a cooldown (ignore codes until the frame is clear for 300 ms).
- Keep the torch state across items.
- Use the duplicate debounce from section 7.
- Persist scans immediately (IndexedDB or the app store), not in component state.

---

## 9. Reference implementation

Assumptions: React 18+, Vite, `zxing-wasm` 3.x (confirm the export names with `npm view zxing-wasm` and the README; the `formats` names `EAN13`, `EAN8`, `UPCA` follow the README style but must be checked against the canonical list). Not compiled or run in this research.

### `src/scanner/barcode.worker.ts`

```ts
/// <reference lib="webworker" />
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';

const FORMATS = ['EAN13', 'EAN8', 'UPCA'] as const;

prepareZXingModule({ fireImmediately: true }).catch(() => {});

type Req = { id: number; bitmap: ImageBitmap };
type Res =
  | { id: number; text: string; format: string }
  | { id: number; text: null };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, bitmap } = e.data;
  try {
    canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height);
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx ??= canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [hit] = await readBarcodes(img, {
      formats: [...FORMATS],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    const res: Res = hit ? { id, text: hit.text, format: hit.format } : { id, text: null };
    self.postMessage(res);
  } catch {
    self.postMessage({ id, text: null } satisfies Res);
  }
};
```

### `src/scanner/eanChecksum.ts`

```ts
export function eanChecksumOk(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
```

### `src/scanner/useBarcodeScanner.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { eanChecksumOk } from './eanChecksum';

export type ScanEvent = { code: string; format: string; at: number };

export type ScannerOptions = {
  onScan: (e: ScanEvent) => void;
  enabled?: boolean;
  /** Centred ROI as fractions of the video frame. */
  roi?: { w: number; h: number };
  /** Ignore the same code for this many ms. */
  dedupeMs?: number;
  /** Max decode attempts per second. */
  maxFps?: number;
};

const DEFAULTS = { roi: { w: 0.9, h: 0.45 }, dedupeMs: 1500, maxFps: 10 };

export function useBarcodeScanner(opts: ScannerOptions) {
  const { onScan, enabled = true } = opts;
  const roi = opts.roi ?? DEFAULTS.roi;
  const dedupeMs = opts.dedupeMs ?? DEFAULTS.dedupeMs;
  const minGap = 1000 / (opts.maxFps ?? DEFAULTS.maxFps);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const lastDecodeRef = useRef(0);
  const lastSeenRef = useRef(new Map<string, number>());
  const nextIdRef = useRef(1);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [error, setError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      // Torch: check capability only; never trust getSettings() for state.
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(Boolean(caps.torch));
    } catch (err) {
      const name = (err as DOMException).name;
      setError(name === 'NotAllowedError' ? 'camera-denied' : 'camera-unavailable');
    }
  }, []);

  const setTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorchOn(on); // our own state, not read back
    } catch {
      setTorchSupported(false);
    }
  }, []);

  // Worker lifecycle
  useEffect(() => {
    const w = new Worker(new URL('./barcode.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; text: string | null; format?: string }>) => {
      busyRef.current = false;
      const { text, format } = e.data;
      if (!text || !eanChecksumOk(text)) return;
      const now = performance.now();
      const last = lastSeenRef.current.get(text);
      if (last !== undefined && now - last < dedupeMs) return;
      lastSeenRef.current.set(text, now);
      onScanRef.current({ code: text, format: format ?? 'unknown', at: Date.now() });
    };
    workerRef.current = w;
    return () => w.terminate();
  }, [dedupeMs]);

  // Frame loop
  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let handle: number | undefined;
    const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    const tick = async () => {
      if (cancelled) return;
      const now = performance.now();
      const ready = video.readyState >= 2 && video.videoWidth > 0;
      if (ready && !busyRef.current && now - lastDecodeRef.current >= minGap && workerRef.current) {
        lastDecodeRef.current = now;
        busyRef.current = true;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sw = Math.round(vw * roi.w);
        const sh = Math.round(vh * roi.h);
        const sx = Math.round((vw - sw) / 2);
        const sy = Math.round((vh - sh) / 2);
        try {
          const bitmap = await createImageBitmap(video, sx, sy, sw, sh);
          workerRef.current.postMessage({ id: nextIdRef.current++, bitmap }, [bitmap]);
        } catch {
          busyRef.current = false;
        }
      }
      if (hasRVFC) {
        handle = (video as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: () => void) => number;
        }).requestVideoFrameCallback(tick);
      } else {
        handle = requestAnimationFrame(tick);
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (hasRVFC) {
        (video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void })
          .cancelVideoFrameCallback?.(handle!);
      } else if (handle !== undefined) {
        cancelAnimationFrame(handle);
      }
    };
  }, [enabled, roi.w, roi.h, minGap]);

  // Stop camera on unmount or disable
  useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled, stop]);

  return { videoRef, start, stop, setTorch, torchOn, torchSupported, error };
}
```

Usage:

```tsx
export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const { videoRef, start, setTorch, torchOn, torchSupported, error } = useBarcodeScanner({
    onScan: (e) => onCode(e.code),
  });
  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted autoPlay />
      <button onClick={start}>Start camera</button>
      {torchSupported && <button onClick={() => setTorch(!torchOn)}>{torchOn ? 'Light off' : 'Light on'}</button>}
      {error === 'camera-denied' && <p>Allow camera in Settings &gt; Safari.</p>}
    </div>
  );
}
```

Notes on the code:
- `createImageBitmap(video, sx, sy, sw, sh)` is used for the ROI crop; the bitmap is transferred to the worker (zero-copy).
- Torch state is tracked locally, not read back (section 4.2).
- `start` must be called from a click (user gesture).
- `playsInline` / `muted` / `autoPlay` on the element are mandatory.
- Checksum validation runs on the main thread after the worker returns; cheap.

---

## 10. iOS gotchas checklist

1. `BarcodeDetector` is off on iOS 17 to 26. Do not depend on it.
2. `facingMode: environment` may choose ultra-wide or switch lenses. Log `track.getSettings()` and test on iPhone 15 Pro.
3. Torch: `applyConstraints` may succeed while `getSettings()` is stale. Track state yourself.
4. Zoom is not exposed. Use ROI crop instead.
5. Camera permission can be re-requested in standalone mode. Request in a user gesture; keep the video element mounted; avoid hash changes while scanning.
6. `<video>` needs `playsinline`, `muted`, `autoplay`; `play()` after a gesture.
7. Decode in a Worker with `ImageBitmap` transfer; keep one decode in flight.
8. Use `requestVideoFrameCallback` (Safari 15.4+) with rAF fallback.
9. Crop to the barcode band; restrict `formats` to EAN13/EAN8/UPCA.
10. Debounce duplicates (1.5 s) and validate checksums.

---

## 11. Open items (UNVERIFIED)

- Latest npm versions for zxing-wasm, barcode-detector, html5-qrcode, @ericblade/quagga2, @undecaf/zbar-wasm, @zxing/library: run `npm view` before pinning.
- Exact EAN-13 accuracy and ms/frame on iPhone 13 and 15 Pro in dim light: no data; run a benchmark.
- Torch reliability by iOS version (17, 18, 26): no confirmed release note.
- Rear lens selection fix via `deviceId` on iOS 18+: forum suggestion only.
- Status of WebKit bugs 215884, 275527 and the every-launch permission prompt on iOS 18 to 26.
- Safari 26.x feature lists: no mention of Shape Detection found; full review not completed.
- Commercial pricing: Scanbot, Scandit, STRICH, Dynamsoft figures are from search snippets and third-party listings; confirm with vendor quotes.
- Licences for html5-qrcode, quagga2, zbar-wasm wrapper, @zxing/library: not confirmed from primary source.

---

## 12. Sources

- caniuse BarcodeDetector: https://caniuse.com/mdn-api_barcodedetector
- WebKit bug 281848 (Shape Detection on iOS): https://bugs.webkit.org/show_bug.cgi?id=281848
- Apple Developer Forums, Shape Detection Safari 18.X: https://developer.apple.com/forums/thread/767761
- WebKit bug 198174 (BarcodeDetector request): https://bugs.webkit.org/show_bug.cgi?id=198174
- zxing-wasm: https://github.com/Sec-ant/zxing-wasm
- barcode-detector: https://github.com/Sec-ant/barcode-detector
- Socket zxing-wasm 3.1.3: https://socket.dev/npm/package/zxing-wasm/overview/3.1.3
- zbar-wasm (Socket): https://socket.dev/npm/package/@undecaf/zbar-wasm
- quagga2: https://github.com/ericblade/quagga2
- Scanbot vs html5-qrcode: https://scanbot.io/blog/quagga2-vs-html5-qrcode-scanner/
- Scanbot pricing and licensing: https://docs.scanbot.io/faq/pricing-and-licensing-model/
- Dynamsoft pricing: https://www.dynamsoft.com/barcode-reader/pricing/
- Dynamsoft benchmark (vendor): https://www.dynamsoft.com/codepool/benchmark-barcode-reading-javascript-zxing-wasm-dynamsoft-barcode-reader.html
- STRICH: https://strich.io/
- WebKit bug 280970 (torch stale on iOS 18): https://bugs.webkit.org/show_bug.cgi?id=280970
- WebKit bug 243075 (torch ignored on iOS 15): https://bugs.webkit.org/show_bug.cgi?id=243075
- WebKit bug 253186 (ultra-wide for environment): https://bugs.webkit.org/show_bug.cgi?id=253186
- WebKit bug 262416 (triple camera switch): https://bugs.webkit.org/show_bug.cgi?id=262416
- Apple Developer Forums, lens switching iOS 18: https://developer.apple.com/forums/thread/776460
- Apple Developer Forums, repeated camera prompts: https://developer.apple.com/forums/thread/788518
- WebKit bug 275527 (PWA camera freeze iOS 17.5.1): https://lists.webkit.org/pipermail/webkit-unassigned/2024-June/1170250.html
- WebKit bug 215884 (standalone permission revoked on hash change): https://bugs.webkit.org/show_bug.cgi?id=215884
- web.dev requestVideoFrameCallback: https://web.dev/articles/requestvideoframecallback-rvfc
- WebKit bug 263010 (OffscreenCanvas): https://bugs.webkit.org/show_bug.cgi?id=263010
- WebKit Safari 26.0 features: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
</content>
