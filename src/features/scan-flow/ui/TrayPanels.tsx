import { Check } from 'lucide-react';
import type { Pantry, PantryId } from '@/domain/types';
import { t } from '@/shared/i18n';
import { haptic } from '@/shared/lib/haptics';
import { Button, ListRow, ListSection, SheetHeader } from '@/shared/ui';
import type { ScanMode } from '../model/tray';
import { CoverPanel } from './CoverPanel';

export interface PantryPickerPanelProps {
  open: boolean;
  mode: ScanMode;
  pantries: readonly Pantry[];
  current: PantryId | null;
  /** Units of each cellier, for the row subtitle. */
  unitsIn: (pantryId: PantryId) => number;
  onClose: () => void;
  onSelect: (pantryId: PantryId) => void;
}

/** «Vers quel cellier ?» / «Depuis quel cellier ?» (03 §4.4.8). Changing it retargets every row. */
export function PantryPickerPanel({
  open,
  mode,
  pantries,
  current,
  unitsIn,
  onClose,
  onSelect,
}: PantryPickerPanelProps) {
  const title = mode === 'add' ? t('scanner.pantryPicker.to') : t('scanner.pantryPicker.from');
  return (
    <CoverPanel open={open} onClose={onClose} label={title} header={<SheetHeader title={title} />}>
      <ListSection label={title}>
        {pantries.map((p) => (
          <ListRow
            key={p.id}
            title={p.name}
            subtitle={t('common.itemsCount', { n: unitsIn(p.id) })}
            selected={p.id === current}
            trailing={p.id === current ? <Check size={20} aria-hidden="true" className="text-accent-fg" /> : undefined}
            onPress={() => onSelect(p.id)}
          />
        ))}
      </ListSection>
    </CoverPanel>
  );
}

export interface CloseConfirmPanelProps {
  open: boolean;
  /** Units in the tray. */
  count: number;
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}

/** Closing with items in the tray (03 §4.4.8): «Enregistrer», «Abandonner» (destructive, H4), «Continuer le scan». */
export function CloseConfirmPanel({ open, count, onSave, onDiscard, onContinue }: CloseConfirmPanelProps) {
  const title = t('scanner.close.title', { n: count });
  return (
    <CoverPanel open={open} onClose={onContinue} label={title}>
      <div className="flex flex-col gap-2 px-4 pt-2">
        <p className="pb-2 text-center type-headline">{title}</p>
        <Button fullWidth onClick={onSave}>
          {t('common.save')}
        </Button>
        <Button
          fullWidth
          variant="destructive-plain"
          onClick={() => {
            haptic('destructive');
            onDiscard();
          }}
        >
          {t('scanner.close.discard')}
        </Button>
        <Button fullWidth variant="plain" onClick={onContinue} data-autofocus="">
          {t('scanner.close.continue')}
        </Button>
      </div>
    </CoverPanel>
  );
}
