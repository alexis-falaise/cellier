import { useState } from 'react';
import type { Pantry, PantryId } from '@/domain/types';
import { t } from '@/shared/i18n';
import { Button, ListRow, ListSection, Sheet } from '@/shared/ui';

export interface PutAwaySheetProps {
  open: boolean;
  onClose: () => void;
  pantries: readonly Pantry[];
  /** Pre-selected cellier (the current one, else the first). */
  initialPantryId: PantryId | null;
  onConfirm: (pantry: Pantry) => void;
}

/**
 * «Ranger les courses» (design 03 §4.8.4, `?sheet=put-away`): fit detent, a cellier picker and one
 * button. Used when the household has two or more celliers and no single one is selected.
 */
export function PutAwaySheet({ open, onClose, pantries, initialPantryId, onConfirm }: PutAwaySheetProps) {
  const [picked, setPicked] = useState<PantryId | null>(null);
  const selected = pantries.find((p) => p.id === (picked ?? initialPantryId)) ?? pantries[0] ?? null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onExited={() => setPicked(null)}
      title={t('putAway.title')}
      closeLabel={t('common.close')}
      footer={
        selected ? (
          <Button fullWidth size="large" onClick={() => onConfirm(selected)}>
            {t('groceries.putAway', { pantry: selected.name })}
          </Button>
        ) : null
      }
    >
      <p className="px-8 pb-4 type-subhead text-label-secondary">{t('putAway.body')}</p>
      <ListSection label={t('putAway.title')}>
        {pantries.map((p) => (
          <ListRow
            key={p.id}
            variant="value"
            title={p.name}
            selected={p.id === selected?.id}
            onPress={() => setPicked(p.id)}
          />
        ))}
      </ListSection>
    </Sheet>
  );
}
