import { useMemo, useState } from 'react';
import type { CategoryId, ProductId } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { useProductViews } from '@/entities/product';
import { t } from '@/shared/i18n';
import {
  CategoryPicker,
  categoryVisual,
  ListRow,
  ListSection,
  SheetHeader,
  SheetTextButton,
  TextField,
} from '@/shared/ui';
import { parsePriceCents, parseSize } from '../model/entry';
import type { NewProductInput } from '../model/tray';
import { CoverPanel } from './CoverPanel';
import { searchProducts } from './productSearch';

export interface UnknownProductSheetProps {
  open: boolean;
  /** Code digits shown as a footnote; null when there is none. */
  digits: string | null;
  /** In-store code: offer the household's products that match the name (03 §4.4.8 StoreCodeSheet). */
  offerExisting: boolean;
  initial?: NewProductInput | null | undefined;
  onClose: () => void;
  onCreate: (input: NewProductInput) => void;
  onPick: (productId: ProductId) => void;
}

/**
 * «Nouveau produit» (03 §4.4.8): name, category (default «Autres»), optional size and price. OK enabled once a
 * name is entered. For an in-store code the same sheet lists matching household products to choose instead.
 */
export function UnknownProductSheet(props: UnknownProductSheetProps) {
  return (
    <CoverPanel
      open={props.open}
      onClose={props.onClose}
      label={t('scanner.unknown.title')}
      detent="large"
      header={null}
    >
      {props.open ? <Form {...props} /> : null}
    </CoverPanel>
  );
}

function Form({ digits, offerExisting, initial, onClose, onCreate, onPick }: UnknownProductSheetProps) {
  const categories = useCategories();
  const products = useProductViews();
  const fallbackCategory = useMemo(
    () => (categories.find((c) => c.templateKey === 'autre') ?? categories[categories.length - 1])?.id ?? null,
    [categories],
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [categoryId, setCategoryId] = useState<CategoryId | null>(initial?.categoryId ?? null);
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const parsedSize = parseSize(size);
  const parsedPrice = parsePriceCents(price);
  const sizeError = submitted && parsedSize === 'invalid' ? t('validation.sizePositive') : undefined;
  const priceError = submitted && parsedPrice === 'invalid' ? t('validation.pricePositive') : undefined;
  const canSave = name.trim().length > 0;
  const matches = offerExisting ? searchProducts(products, name) : [];

  const options = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, visual: categoryVisual(c) })),
    [categories],
  );

  const save = () => {
    setSubmitted(true);
    if (!canSave || parsedSize === 'invalid' || parsedPrice === 'invalid') return;
    onCreate({
      name: name.trim().slice(0, 120),
      categoryId: categoryId ?? fallbackCategory,
      netQuantity: parsedSize?.netQuantity ?? null,
      netUnit: parsedSize?.netUnit ?? null,
      priceCents: parsedPrice ?? null,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SheetHeader
        leading={<SheetTextButton onPress={onClose}>{t('common.cancel')}</SheetTextButton>}
        title={t('scanner.unknown.title')}
        trailing={
          <SheetTextButton emphasis disabled={!canSave} onPress={save}>
            {t('common.done')}
          </SheetTextButton>
        }
      />
      {digits ? (
        <p className="-mt-4 px-8 type-footnote text-label-secondary">{t('scanner.row.code', { digits })}</p>
      ) : null}
      <ListSection header={t('field.name')}>
        <TextField
          label={t('field.name')}
          layout="stacked"
          value={name}
          onChange={setName}
          placeholder={t('scanner.unknown.placeholder')}
          autoFocus
          maxLength={120}
          enterKeyHint="done"
          error={submitted && !canSave ? t('validation.nameRequired') : undefined}
        />
      </ListSection>
      {matches.length > 0 ? (
        <ListSection header={t('newItem.existing')}>
          {matches.map((v) => (
            <ListRow key={v.product.id} title={v.product.name} onPress={() => onPick(v.product.id)} />
          ))}
        </ListSection>
      ) : null}
      <section aria-label={t('field.category')} className="flex flex-col gap-2">
        <h3 className="px-8 type-footnote text-label-secondary">{t('field.category')}</h3>
        <CategoryPicker
          label={t('field.category')}
          categories={options}
          value={categoryId ?? fallbackCategory}
          onChange={(id) => setCategoryId(id as CategoryId)}
        />
      </section>
      <ListSection footer={t('scanner.unknown.optional')}>
        <TextField
          label={t('field.size')}
          value={size}
          onChange={setSize}
          placeholder={t('scanner.unknown.sizePlaceholder')}
          error={sizeError}
          enterKeyHint="next"
        />
        <TextField
          label={t('field.unitPrice')}
          value={price}
          onChange={setPrice}
          inputMode="decimal"
          placeholder={t('scanner.unknown.pricePlaceholder')}
          error={priceError}
          enterKeyHint="done"
        />
      </ListSection>
    </div>
  );
}
