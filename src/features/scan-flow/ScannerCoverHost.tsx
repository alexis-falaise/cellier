import { useRef } from 'react';
import { closeScanner, getScannerOrigin, useOverlay } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { ScannerCover } from '@/shared/ui';
import { ScanSession } from './ui/ScanSession';

/**
 * Mounted once by the tab shell: renders ScannerCover for `?cover=scan&mode=add|withdraw` (03 §4.4). The cover grows
 * from the scan button's rect; the session inside reads the mode once and owns everything else as local state.
 */
export function ScannerCoverHost() {
  const overlay = useOverlay();
  const open = overlay.cover === 'scan';
  const requestClose = useRef<() => void>(closeScanner);
  return (
    <ScannerCover
      open={open}
      onClose={() => requestClose.current()}
      originRect={getScannerOrigin()}
      label={t('scanner.label')}
    >
      <ScanSession
        initialMode={overlay.mode ?? 'add'}
        onRegisterClose={(close) => {
          requestClose.current = close;
        }}
      />
    </ScannerCover>
  );
}
