import { ReceiptText } from 'lucide-react';
import { useRef, useState } from 'react';
import { closeSheet, openSheet, useOverlay, useScreen } from '@/app/navigation';
import { useActivePantry } from '@/app/session';
import { t } from '@/shared/i18n';
import { IconButton } from '@/shared/ui';
import { ReceiptSheet } from './ui/ReceiptSheet';

/**
 * «Scanner un ticket»: a header button that opens the camera (or the photo library) through a file
 * input, then the receipt review sheet (`?sheet=receipt`). The photo stays in memory only.
 */
export function ReceiptEntry() {
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const overlay = useOverlay();
  const screen = useScreen();
  const { pantry, pantries } = useActivePantry();
  const open = overlay.sheet === 'receipt' && (screen?.active ?? true) && photo !== null;

  const pick = () => {
    if (input.current) {
      input.current.value = '';
      input.current.click();
    }
  };

  return (
    <>
      <IconButton icon={ReceiptText} label={t('receipt.scan')} onClick={pick} />
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setPhoto(file);
          if (overlay.sheet !== 'receipt') openSheet({ sheet: 'receipt' });
        }}
      />
      <ReceiptSheet
        open={open}
        photo={photo}
        pantries={pantries}
        currentPantryId={pantry?.id ?? null}
        onClose={() => {
          closeSheet();
        }}
        onRetake={pick}
      />
    </>
  );
}
