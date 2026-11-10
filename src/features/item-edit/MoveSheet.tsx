import { useState } from 'react';
import { closeSheet } from '@/app/navigation';
import { showToast } from '@/app/toasts';
import type { Pantry, PantryId, ProductId, ProductView } from '@/domain/types';
import { t } from '@/shared/i18n';
import { ListRow, ListSection, QuantityNumber, QuantityStepper, Sheet, SheetTextButton } from '@/shared/ui';
import { tryMutate } from '@/widgets/item/stockActions';

/** Default source of MoveSheet: the cellier holding the most stock (first in order on a tie). */
export function defaultMoveSource(perPantry: ProductView['perPantry']): string | null {
  let best: { pantryId: string; quantity: number } | null = null;
  for (const row of perPantry) if (row.quantity > 0 && (!best || row.quantity > best.quantity)) best = row;
  return best?.pantryId ?? null;
}

/**
 * MoveSheet (design 03 §4.6.9, `?sheet=item-move&id=…`, large): «Depuis» (celliers holding stock,
 * default the fullest), «Vers» (the other celliers), «Quantité» (default all, max the source
 * stock). One `stock.transfer`; the server clamps to the shelf (02 §2.5.6).
 */
export function MoveSheet({
  open,
  view,
  pantries,
  onExited,
}: {
  open: boolean;
  view: ProductView;
  pantries: readonly Pantry[];
  onExited: () => void;
}) {
  const stocked = view.perPantry.filter((r) => r.quantity > 0);
  const [from, setFrom] = useState<string | null>(() => defaultMoveSource(view.perPantry));
  const source = stocked.find((r) => r.pantryId === from) ?? stocked[0];
  const available = source?.quantity ?? 0;
  const targets = pantries.filter((p) => p.id !== source?.pantryId);
  const [to, setTo] = useState<string | null>(() => targets[0]?.id ?? null);
  const target = targets.find((p) => p.id === to) ?? targets[0];
  const [quantity, setQuantity] = useState<number | null>(null);
  const amount = Math.min(available, quantity ?? available);
  const names = new Map(pantries.map((p) => [p.id as string, p.name]));

  const move = () => {
    if (!source || !target || amount <= 0) return;
    const id = tryMutate('stock.transfer', {
      fromPantryId: source.pantryId,
      toPantryId: target.id as PantryId,
      productId: view.product.id as ProductId,
      quantity: amount,
      source: 'form',
    });
    if (id)
      showToast({ message: t('toast.moved', { n: amount, pantry: target.name }), key: `moved:${view.product.id}` });
    closeSheet();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
      detents={['large']}
      title={t('move.title')}
      leading={<SheetTextButton onPress={closeSheet}>{t('common.cancel')}</SheetTextButton>}
      trailing={
        <SheetTextButton emphasis disabled={!source || !target || amount <= 0} onPress={move}>
          {t('move.cta')}
        </SheetTextButton>
      }
      closeLabel={t('common.close')}
      onExited={onExited}
    >
      <div className="flex flex-col gap-8 pt-2 pb-[calc(var(--safe-bottom)+24px)]" data-sheet-scroll>
        <p className="mx-8 text-center type-headline text-label-primary">{view.product.name}</p>
        <ListSection header={t('move.from')}>
          {stocked.map((row) => (
            <ListRow
              key={row.pantryId}
              variant="value"
              title={names.get(row.pantryId) ?? ''}
              value={<QuantityNumber value={row.quantity} size="row" />}
              selected={row.pantryId === source?.pantryId}
              onPress={() => {
                setFrom(row.pantryId);
                setQuantity(null);
                if (to === row.pantryId) setTo(null);
              }}
            />
          ))}
        </ListSection>
        <ListSection header={t('move.to')}>
          {targets.map((p) => (
            <ListRow
              key={p.id}
              variant="value"
              title={p.name}
              selected={p.id === target?.id}
              onPress={() => setTo(p.id)}
            />
          ))}
        </ListSection>
        <ListSection label={t('field.quantity')}>
          <ListRow
            variant="plain"
            title={t('field.quantity')}
            trailing={
              <QuantityStepper
                value={amount}
                onChange={(v) => setQuantity(Math.max(1, Math.min(available, Math.round(v))))}
                min={1}
                max={Math.max(1, available)}
                label={t('field.quantity')}
                decrementLabel={t('a11y.item.remove1')}
                incrementLabel={t('a11y.item.add1')}
                editLabel={t('field.quantity')}
              />
            }
          />
        </ListSection>
      </div>
    </Sheet>
  );
}
