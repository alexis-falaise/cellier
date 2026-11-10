import { type LucideIcon, Minus, Plus } from 'lucide-react';
import { m } from 'motion/react';
import { openSheet } from '@/app/navigation';
import type { Pantry } from '@/domain/types';
import { t } from '@/shared/i18n';
import { ListRow, ListSection, QuantityNumber, QuantityStepper, usePress } from '@/shared/ui';
import { useStockStepper } from '@/widgets/item/stockActions';

interface StockRowRef {
  pantryId: string;
  quantity: number;
}

export interface QuantityBlockProps {
  productId: string;
  rows: readonly StockRowRef[];
  pantries: readonly Pantry[];
  /** Cellier of the single-cellier variant when the product has no stock row. */
  fallbackPantryId: string | null;
  disabled?: boolean | undefined;
}

/**
 * Quantity block (design 03 §4.6.2): a large stepper for a product stocked in one cellier (tap the
 * value to recount), the household total when it is stocked in several (steppers move to «Par
 * cellier», §4.6.3).
 */
export function QuantityBlock({ productId, rows, pantries, fallbackPantryId, disabled }: QuantityBlockProps) {
  const names = new Map(pantries.map((p) => [p.id as string, p.name]));
  if (rows.length >= 2) {
    const total = rows.reduce((sum, r) => sum + r.quantity, 0);
    return (
      <>
        <div className="flex flex-col items-center pt-6">
          <span role="img" aria-label={t('a11y.item.qtyValue', { n: total })}>
            <QuantityNumber value={total} size="stepper-large" muted={total === 0} />
          </span>
          <p className="mt-1 type-subhead text-label-secondary">{t('item.qty.captionMulti', { n: rows.length })}</p>
        </div>
        <ListSection header={t('item.pantries.title')} className="mt-8">
          {rows.map((row) => (
            <PantryStockRow
              key={row.pantryId}
              productId={productId}
              pantryId={row.pantryId}
              name={names.get(row.pantryId) ?? ''}
              quantity={row.quantity}
              disabled={disabled}
            />
          ))}
        </ListSection>
      </>
    );
  }
  const row = rows[0];
  const pantryId = row?.pantryId ?? fallbackPantryId;
  return (
    <SingleStock
      key={pantryId ?? 'none'}
      productId={productId}
      pantryId={pantryId}
      pantryName={pantryId ? (names.get(pantryId) ?? '') : ''}
      quantity={row?.quantity ?? 0}
      disabled={disabled}
    />
  );
}

function SingleStock({
  productId,
  pantryId,
  pantryName,
  quantity,
  disabled,
}: {
  productId: string;
  pantryId: string | null;
  pantryName: string;
  quantity: number;
  disabled?: boolean | undefined;
}) {
  const stepper = useStockStepper(pantryId, productId, quantity);
  const off = disabled || !pantryId;
  return (
    <div className="flex flex-col items-center pt-6">
      <div className="flex items-center gap-3">
        <RoundButton
          icon={Minus}
          label={t('a11y.item.remove1')}
          disabled={off || stepper.value <= 0}
          onPress={() => stepper.setValue(stepper.value - 1)}
        />
        <button
          type="button"
          disabled={off}
          aria-label={t('a11y.item.qtyValue', { n: stepper.value })}
          aria-description={t('a11y.item.recountHint')}
          onClick={() => {
            stepper.flush();
            if (pantryId) openSheet({ sheet: 'recount', id: productId, pantry: pantryId });
          }}
          className="flex min-h-11 min-w-[72px] items-center justify-center rounded-sm outline-none focus-visible:focus-ring"
        >
          <QuantityNumber value={stepper.value} size="stepper-large" muted={stepper.value === 0} live />
        </button>
        <RoundButton
          icon={Plus}
          label={t('a11y.item.add1')}
          disabled={off}
          onPress={() => stepper.setValue(stepper.value + 1)}
        />
      </div>
      {pantryName ? (
        <p className="mt-1 type-subhead text-label-secondary">{t('item.qty.caption', { pantry: pantryName })}</p>
      ) : null}
    </div>
  );
}

function RoundButton({
  icon: Icon,
  label,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { scale, handlers } = usePress(0.92, disabled);
  return (
    <m.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      {...handlers}
      style={{ scale }}
      className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full border border-edge bg-fill-secondary text-label-primary outline-none focus-visible:focus-ring disabled:opacity-40 motion-reduce:data-pressed:opacity-60"
    >
      <Icon size={22} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
    </m.button>
  );
}

function PantryStockRow({
  productId,
  pantryId,
  name,
  quantity,
  disabled,
}: {
  productId: string;
  pantryId: string;
  name: string;
  quantity: number;
  disabled?: boolean | undefined;
}) {
  const stepper = useStockStepper(pantryId, productId, quantity);
  return (
    <ListRow
      variant="plain"
      title={name}
      trailing={
        disabled ? (
          <QuantityNumber value={quantity} size="stepper" muted={quantity === 0} />
        ) : (
          <QuantityStepper
            value={stepper.value}
            onChange={stepper.setValue}
            label={name}
            decrementLabel={t('a11y.item.remove1')}
            incrementLabel={t('a11y.item.add1')}
            editLabel={t('a11y.item.recountIn', { pantry: name })}
          />
        )
      }
    />
  );
}
