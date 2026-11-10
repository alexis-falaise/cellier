import { ArrowDown, ArrowUp } from 'lucide-react';
import { useId } from 'react';
import { closeSheet } from '@/app/navigation';
import { STOCK_DEFAULTS, type StockGroup, type StockSort } from '@/app/search';
import { t } from '@/shared/i18n';
import { ListRow, ListSection, Sheet, SheetTextButton, Switch } from '@/shared/ui';
import type { PlainMessageKey } from '@/widgets/item/productText';
import type { StockViewOptions } from './model/stockList';
import { useStockUrl } from './model/stockUrl';
import { writeStockView } from './model/viewPrefs';

const GROUPS: ReadonlyArray<{ value: StockGroup; label: PlainMessageKey }> = [
  { value: 'category', label: 'stock.view.group.category' },
  { value: 'item', label: 'stock.view.group.item' },
  { value: 'added', label: 'stock.view.group.added' },
  { value: 'price', label: 'stock.view.group.price' },
  { value: 'quantity', label: 'stock.view.group.quantity' },
];

const SORTS: ReadonlyArray<{ value: StockSort; label: PlainMessageKey }> = [
  { value: 'name', label: 'stock.view.sort.name' },
  { value: 'category', label: 'stock.view.sort.category' },
  { value: 'recent', label: 'stock.view.sort.recent' },
  { value: 'price', label: 'stock.view.sort.price' },
  { value: 'quantity', label: 'stock.view.sort.quantity' },
];

/**
 * StockViewSheet «Affichage» (design 03 §4.5.3): «Grouper par», «Trier par» (tapping the selected
 * sort flips its direction) and «Afficher les épuisés». Choices persist on the device; the URL
 * carries the non-default ones. Changes apply to the list at once, without motion.
 */
export function StockViewSheet({ open, view }: { open: boolean; view: StockViewOptions }) {
  const writeUrl = useStockUrl();
  const switchLabel = useId();
  const sort = view.group === 'category' && view.sort === 'category' ? 'name' : view.sort;

  const setGroup = (group: StockGroup) => {
    writeStockView({ group });
    writeUrl({ group: group === STOCK_DEFAULTS.group ? undefined : group });
  };

  const setSort = (next: StockSort) => {
    const dir = next === sort ? (view.dir === 'asc' ? 'desc' : 'asc') : 'asc';
    writeStockView({ sort: next, dir });
    writeUrl({
      sort: next === STOCK_DEFAULTS.sort ? undefined : next,
      dir: dir === STOCK_DEFAULTS.dir ? undefined : dir,
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
      title={t('stock.view.title')}
      trailing={
        <SheetTextButton emphasis onPress={closeSheet}>
          {t('common.done')}
        </SheetTextButton>
      }
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-6 pt-2 pb-2">
        <ListSection header={t('stock.view.groupBy')}>
          {GROUPS.map((g) => (
            <ListRow
              key={g.value}
              variant="value"
              title={t(g.label)}
              selected={view.group === g.value}
              onPress={() => setGroup(g.value)}
            />
          ))}
        </ListSection>
        <ListSection header={t('stock.view.sortBy')}>
          {SORTS.filter((s) => !(view.group === 'category' && s.value === 'category')).map((s) => {
            const selected = sort === s.value;
            const Arrow = view.dir === 'asc' ? ArrowUp : ArrowDown;
            const dirLabel = view.dir === 'asc' ? t('a11y.sort.asc') : t('a11y.sort.desc');
            return (
              <ListRow
                key={s.value}
                variant="value"
                title={t(s.label)}
                aria-label={selected ? `${t(s.label)}, ${dirLabel}` : t(s.label)}
                onPress={() => setSort(s.value)}
                trailing={
                  selected ? (
                    <Arrow
                      size={20}
                      strokeWidth={2}
                      absoluteStrokeWidth
                      aria-hidden="true"
                      className="shrink-0 text-accent-fg"
                    />
                  ) : null
                }
              />
            );
          })}
        </ListSection>
        <ListSection>
          <ListRow
            variant="toggle"
            title={<span id={switchLabel}>{t('stock.view.showEmpty')}</span>}
            trailing={
              <Switch
                checked={view.showEmpty}
                labelledBy={switchLabel}
                onCheckedChange={(showEmpty) => writeStockView({ showEmpty })}
              />
            }
          />
        </ListSection>
      </div>
    </Sheet>
  );
}
