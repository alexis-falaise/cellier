import { useState } from 'react';
import { closeSheet } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { Sheet, SheetTextButton } from '@/shared/ui';
import { recountStock } from '@/widgets/item/stockActions';

/** Count typed in RecountSheet: digits only, 0–99 999; null while empty. */
export function parseCount(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  if (digits === '') return null;
  return Math.min(99_999, Number(digits));
}

/**
 * RecountSheet (design 03 §4.6.2, `?sheet=recount&id=…&pantry=…`, auto detent): «Combien en
 * reste-t-il dans {pantry} ?» over a centred numeric input with the current value selected. Saves
 * a recount movement (absolute, not demand).
 */
export function RecountSheet({
  open,
  productId,
  pantryId,
  pantryName,
  current,
  onExited,
}: {
  open: boolean;
  productId: string;
  pantryId: string;
  pantryName: string;
  current: number;
  onExited: () => void;
}) {
  const [text, setText] = useState(String(current));
  const value = parseCount(text);
  const save = () => {
    if (value === null) return;
    if (value !== current) recountStock(pantryId, productId, value, 'form');
    closeSheet();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
      detents={['fit']}
      title={t('recount.title')}
      leading={<SheetTextButton onPress={closeSheet}>{t('common.cancel')}</SheetTextButton>}
      trailing={
        <SheetTextButton emphasis disabled={value === null} onPress={save}>
          {t('common.save')}
        </SheetTextButton>
      }
      closeLabel={t('common.close')}
      onExited={onExited}
    >
      <form
        className="flex flex-col items-center gap-4 px-4 pt-2 pb-[calc(var(--safe-bottom)+24px)]"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor="recount-input" className="text-center type-body text-label-primary">
          {t('recount.body', { pantry: pantryName })}
        </label>
        <input
          id="recount-input"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          // biome-ignore lint/a11y/noAutofocus: the sheet exists to type this number
          autoFocus
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.currentTarget.value.replace(/\D/g, '').slice(0, 5))}
          className="w-40 rounded-md border border-edge bg-fill-tertiary py-2 text-center font-rounded type-large-title tabular-nums text-label-primary outline-none focus-visible:focus-ring"
        />
      </form>
    </Sheet>
  );
}
