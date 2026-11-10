import { Barcode, Trash } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import type { Category, PantryId } from '@/domain/types';
import { useProductView } from '@/entities/product';
import { formatQuantity, t } from '@/shared/i18n';
import { presets } from '@/shared/lib/motion';
import { CategoryTile, type CategoryVisual, categoryVisual, cx, IconButton, QuantityStepper } from '@/shared/ui';
import { effectiveQuantity, MAX_QUANTITY, type TrayRow as Row, type RowView, type ScanMode } from '../model/tray';

export interface TrayRowProps {
  row: Row;
  view: RowView;
  mode: ScanMode;
  categories: readonly Category[];
  pantryName: (id: PantryId | null) => string;
  /** The tray's cellier. */
  trayPantryId: PantryId | null;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  /** Unknown / offline row: open the unknown-product sheet. */
  onName: () => void;
  /** In-store code: choose or create the product. */
  onPick: () => void;
  onTakeFrom: (pantryId: PantryId) => void;
}

interface Display {
  name: string;
  /** Rounded tabular figures (code digits). */
  digits: boolean;
  status: string;
  visual: CategoryVisual | null;
  action: { label: string; onPress: () => void } | null;
}

/**
 * One scanned product in the tray (03 §4.4.2–4.4.3): tile, name, status line, compact stepper (default 1; at 1 the
 * minus takes the row out, with «Annuler» in the tray header). New rows fall from the reticle (`smooth`).
 */
export function TrayRow(props: TrayRowProps) {
  const { row, view, onQuantity, onRemove } = props;
  const reduced = useReducedMotion();
  const productId = row.status.kind === 'household' ? row.status.productId : '';
  const product = useProductView(productId);
  const d = rowDisplay(props, product?.product.name ?? null, product?.category ?? null);

  const absent = view.kind === 'absent';
  const max = view.kind === 'withdraw' ? view.max : MAX_QUANTITY;
  const value = effectiveQuantity(row, view);
  const transition = reduced ? presets.reduced : presets.smooth;

  return (
    <m.li
      className={cx('flex min-h-16 items-center gap-3 px-4 py-2', absent && 'opacity-50')}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0, transition }}
      exit={{ opacity: 0, transition }}
    >
      <m.span
        className="shrink-0"
        initial={reduced ? false : { scale: 0.6 }}
        animate={{ scale: 1, transition: reduced ? presets.reduced : presets.pop }}
      >
        {d.visual ? (
          <CategoryTile visual={d.visual} size={36} />
        ) : (
          <CategoryTile icon={Barcode} hue="pebble" size={36} />
        )}
      </m.span>
      <div className="min-w-0 flex-1">
        <p className={cx('truncate type-subhead font-semibold text-stone-0', d.digits && 'font-rounded tabular-nums')}>
          {d.name}
        </p>
        <p className="truncate type-footnote text-stone-0/60">{d.status}</p>
        {d.action ? (
          <button
            type="button"
            onClick={d.action.onPress}
            className="relative mt-0.5 type-footnote font-semibold text-green-300 outline-none before:absolute before:-inset-x-2 before:-inset-y-3 focus-visible:focus-ring active:opacity-60"
          >
            {d.action.label}
          </button>
        ) : null}
      </div>
      {absent ? (
        <IconButton icon={Trash} label={t('scanner.row.remove')} tone="on-dark" iconSize={20} onClick={onRemove} />
      ) : (
        <QuantityStepper
          value={value}
          min={0}
          max={max}
          onChange={(q) => onQuantity(q)}
          onDark
          label={t('scanner.row.quantity', { product: d.name })}
          decrementLabel={value <= 1 ? t('scanner.row.remove') : t('a11y.item.remove1')}
          incrementLabel={t('a11y.item.add1')}
          editLabel={t('scanner.row.editQuantity')}
        />
      )}
    </m.li>
  );
}

function sizeLabel(netQuantity: number | null, netUnit: 'g' | 'ml' | 'piece' | null): string | null {
  if (netQuantity === null || netUnit === null) return null;
  return formatQuantity(netQuantity, netUnit);
}

function rowDisplay(p: TrayRowProps, productName: string | null, category: Category | null): Display {
  const { row, view, categories } = p;
  const s = row.status;
  const visualOf = (id: string | null) => {
    const c = id ? categories.find((x) => x.id === id) : undefined;
    return c ? categoryVisual(c) : null;
  };
  const codeName = row.digits ? t('scanner.row.code', { digits: row.digits }) : t('scanner.row.unknown');

  // Withdraw-specific status lines first (they apply to household products only).
  const withdrawStatus = (): string | null => {
    if (view.kind === 'withdraw') {
      const base = t('scanner.row.inStockPantry', { pantry: p.pantryName(view.pantryId), n: view.max });
      return row.quantity >= view.max ? `${base} ${t('scanner.row.max', { n: view.max })}` : base;
    }
    if (view.kind === 'elsewhere') {
      return t('scanner.row.elsewhere', {
        pantry: p.pantryName(p.trayPantryId),
        n: view.quantity,
        other: p.pantryName(view.other),
      });
    }
    if (view.kind === 'absent') return t('scanner.row.absent');
    return null;
  };
  const elsewhereAction =
    view.kind === 'elsewhere'
      ? {
          label: t('scanner.row.takeFrom', { other: p.pantryName(view.other) }),
          onPress: () => p.onTakeFrom(view.other),
        }
      : null;

  switch (s.kind) {
    case 'searching':
      return { name: row.digits, digits: true, status: t('scanner.row.searching'), visual: null, action: null };
    case 'store-code':
      return {
        name: t('scanner.row.storeCode'),
        digits: false,
        status: t('scanner.row.code', { digits: row.digits }),
        visual: null,
        action: { label: t('scanner.row.pickItem'), onPress: p.onPick },
      };
    case 'household': {
      const visual = category ? categoryVisual(category) : null;
      const name = productName ?? codeName;
      if (p.mode === 'withdraw') {
        return { name, digits: false, status: withdrawStatus() ?? '', visual, action: elsewhereAction };
      }
      const inStock = view.kind === 'add' ? view.inStock : 0;
      return { name, digits: false, status: t('scanner.row.inStock', { n: inStock }), visual, action: null };
    }
    case 'catalogue': {
      const product = s.product;
      const details = [product.brand, product.quantityLabel ?? sizeLabel(product.netQuantity, product.netUnit)]
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .join(' · ');
      const cat = categories.find((c) => c.templateKey === product.categoryKey && c.deletedAt === null) ?? null;
      const status =
        p.mode === 'withdraw'
          ? t('scanner.row.absent')
          : s.origin === 'online' || details === ''
            ? t('scanner.row.newOff')
            : t('scanner.row.newCatalog', { details });
      return { name: product.name, digits: false, status, visual: cat ? categoryVisual(cat) : null, action: null };
    }
    case 'named': {
      const { input } = s;
      const details =
        sizeLabel(input.netQuantity, input.netUnit) ?? categories.find((c) => c.id === input.categoryId)?.name;
      return {
        name: input.name,
        digits: false,
        status:
          p.mode === 'withdraw'
            ? t('scanner.row.absent')
            : details
              ? t('scanner.row.newCatalog', { details })
              : t('scanner.row.newOff'),
        visual: visualOf(input.categoryId),
        action: null,
      };
    }
    case 'offline':
    case 'unavailable':
      return {
        name: codeName,
        digits: false,
        status:
          p.mode === 'withdraw'
            ? t('scanner.row.absent')
            : s.kind === 'offline'
              ? t('scanner.row.offline')
              : t('scanner.row.unavailable'),
        visual: null,
        action: p.mode === 'add' ? { label: t('scanner.row.name'), onPress: p.onName } : null,
      };
    case 'unknown':
      return {
        name: t('scanner.row.unknown'),
        digits: false,
        status: p.mode === 'withdraw' ? t('scanner.row.absent') : t('scanner.row.code', { digits: row.digits }),
        visual: null,
        action: p.mode === 'add' ? { label: t('scanner.row.name'), onPress: p.onName } : null,
      };
  }
}
