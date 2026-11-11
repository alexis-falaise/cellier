import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CameraPrimer, CameraProblem, DarkTextButton } from '@/features/scan-flow/ui/CameraStates';
import type { ScannerState } from '@/features/scanner';
import { isCameraPrimed, markCameraPrimed, ScannerViewport, type ScannerViewportHandle } from '@/features/scanner';
import { t } from '@/shared/i18n';
import type { ScannedCode } from '@/shared/lib/gtin';
import { haptic } from '@/shared/lib/haptics';
import { IconButton, Reticle, ScannerCover, Spinner } from '@/shared/ui';

export interface LineBarcodeScannerProps {
  /** The line being identified; null closes the cover. */
  lineName: string | null;
  onClose: () => void;
  /** Resolves the code; `false` keeps scanning (not a product code). */
  onCode: (code: ScannedCode) => Promise<boolean>;
}

/**
 * Single-shot barcode scanner over the receipt sheet: one product code identifies one receipt line,
 * then the cover closes. Reuses the scanner engine, its reticle and its camera states.
 */
export function LineBarcodeScanner({ lineName, onClose, onCode }: LineBarcodeScannerProps) {
  return (
    <ScannerCover open={lineName !== null} onClose={onClose} originRect={null} label={t('receipt.scanner.label')}>
      {lineName !== null ? <Session name={lineName} onClose={onClose} onCode={onCode} /> : null}
    </ScannerCover>
  );
}

function Session({
  name,
  onClose,
  onCode,
}: {
  name: string;
  onClose: () => void;
  onCode: LineBarcodeScannerProps['onCode'];
}) {
  const viewport = useRef<ScannerViewportHandle>(null);
  const [camera, setCamera] = useState<ScannerState | null>(null);
  const [primed, setPrimed] = useState(isCameraPrimed);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [successes, setSuccesses] = useState(0);
  const status = camera?.status ?? 'idle';
  const problem = status === 'error' ? camera?.error : null;

  useEffect(() => {
    if (status === 'live' && !primed) {
      markCameraPrimed();
      setPrimed(true);
    }
  }, [status, primed]);

  const detect = (code: ScannedCode) => {
    if (busy) return;
    setBusy(true);
    setInvalid(false);
    void onCode(code)
      .then((done) => {
        if (done) {
          haptic('scan');
          setSuccesses((n) => n + 1);
        } else {
          setInvalid(true);
        }
      })
      .finally(() => setBusy(false));
  };

  const showPrimer = !primed && !problem && status !== 'starting' && status !== 'live';

  return (
    <div className="absolute inset-0">
      <ScannerViewport
        ref={viewport}
        className="absolute inset-0"
        autoStart={primed}
        paused={busy}
        onDetect={detect}
        onStateChange={setCamera}
      >
        {({ rect }) => (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[20px]"
              style={{ boxShadow: '0 0 0 200vmax rgb(0 0 0 / 0.45)' }}
            />
            <Reticle
              successCount={successes}
              tone={invalid ? 'idle' : successes > 0 ? 'success' : 'idle'}
              width={rect.width}
              height={rect.height}
            />
            <div className="pointer-events-none absolute inset-x-0 top-full mt-4 flex flex-col items-center gap-3 px-4 text-center">
              {busy ? (
                <Spinner size={20} className="text-stone-0" />
              ) : (
                <p className="type-footnote text-stone-0/80" aria-live="polite">
                  {invalid ? t('receipt.scanner.invalid') : t('receipt.scanner.hint', { name })}
                </p>
              )}
            </div>
          </>
        )}
      </ScannerViewport>

      {showPrimer ? <CameraPrimer onAllow={() => void viewport.current?.start()} onManual={onClose} /> : null}
      {problem ? (
        <CameraProblem
          denied={problem.code === 'permission-denied'}
          onRetry={() => void viewport.current?.start()}
          onManual={onClose}
        />
      ) : null}
      {primed && status === 'idle' ? (
        <div className="absolute inset-x-0 top-[44%] flex justify-center">
          <DarkTextButton onClick={() => void viewport.current?.start()}>{t('scanner.start')}</DarkTextButton>
        </div>
      ) : null}

      <div className="absolute inset-x-0 top-[calc(var(--safe-top)+8px)] z-20 flex px-2">
        <IconButton icon={X} label={t('receipt.scanner.close')} tone="on-dark" filled onClick={onClose} />
      </div>
    </div>
  );
}
