import { closeSheet, openSheet } from '@/app/navigation';
import { useActivePantry } from '@/app/session';
import type { PantryId } from '@/domain/types';
import { t } from '@/shared/i18n';
import { ListRow, ListSection, Sheet, SheetTextButton } from '@/shared/ui';
import { useItemCounts } from './model/selectors';

/**
 * PantryMenuSheet (design 03 §4.9.1, `?sheet=pantries`, fit detent): «Tous les celliers», then each
 * cellier in household order with its item count and a check on the current one. Selecting closes.
 */
export function PantryMenuSheet({ open, onExited }: { open: boolean; onExited?: (() => void) | undefined }) {
  const { pantries, selection, select } = useActivePantry();
  const counts = useItemCounts();

  const choose = (next: PantryId | 'all') => {
    select(next);
    closeSheet();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
      detents={['fit']}
      title={t('pantries.title')}
      trailing={
        <SheetTextButton emphasis onPress={closeSheet}>
          {t('common.done')}
        </SheetTextButton>
      }
      closeLabel={t('common.close')}
      onExited={onExited}
    >
      <div className="flex flex-col gap-6 pt-2 pb-[calc(var(--safe-bottom)+16px)]">
        <ListSection label={t('pantries.title')}>
          <ListRow
            variant="value"
            title={t('pantry.all')}
            subtitle={t('common.itemsCount', { n: counts.all })}
            selected={selection === 'all'}
            onPress={() => choose('all')}
          />
          {pantries.map((p) => (
            <ListRow
              key={p.id}
              variant="value"
              title={p.name}
              subtitle={t('common.itemsCount', { n: counts.byPantry.get(p.id) ?? 0 })}
              selected={selection === p.id}
              onPress={() => choose(p.id)}
            />
          ))}
        </ListSection>
        <ListSection label={t('pantries.manage')}>
          <ListRow
            variant="button"
            title={t('pantries.manage')}
            onPress={() => openSheet({ sheet: 'settings', page: 'pantries' })}
          />
        </ListSection>
      </div>
    </Sheet>
  );
}
