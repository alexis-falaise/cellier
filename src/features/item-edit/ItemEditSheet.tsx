import { useEffect, useMemo, useState } from 'react';
import { closeSheet, popSheetPage, pushSheetPage, setUnsavedChanges } from '@/app/navigation';
import type { Product } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { useProductViews } from '@/entities/product';
import { propagateCategory } from '@/features/classify';
import { t } from '@/shared/i18n';
import {
  BackButton,
  type CategoryOption,
  CategoryPicker,
  categoryVisual,
  ListRow,
  ListSection,
  QuantityStepper,
  ScreenStack,
  SegmentedControl,
  SheetTextButton,
  type StackScreen,
  TextField,
} from '@/shared/ui';
import { useProductForecast } from '@/widgets/item/forecasts';
import { displayBarcode, type PlainMessageKey } from '@/widgets/item/productText';
import { tryMutate } from '@/widgets/item/stockActions';
import {
  FORM_UNITS,
  type FormUnit,
  formFromProduct,
  hasErrors,
  type ItemForm,
  type ItemFormErrors,
  itemFormDiff,
  validateItemForm,
} from './model/itemForm';
import { SheetPage } from './ui/SheetPage';

export const UNSAVED_KEY = 'item-edit';

export const UNIT_LABELS: Record<FormUnit, PlainMessageKey> = {
  g: 'unit.g',
  kg: 'unit.kg',
  ml: 'unit.ml',
  cl: 'unit.cl',
  l: 'unit.l',
  piece: 'unit.pieces',
};

export function useCategoryOptions(): CategoryOption[] {
  const categories = useCategories();
  return useMemo(() => categories.map((c) => ({ id: c.id, name: c.name, visual: categoryVisual(c) })), [categories]);
}

/**
 * ItemEditSheet (design 03 §4.7): the product's fields in inset sections; «Enregistrer» sends only
 * the changed fields. `step=category` pushes the category picker. Unsaved edits block the swipe
 * down and Cancel with the discard confirmation (`confirm=discard`).
 */
export function ItemEditSheet({
  product,
  step,
  onDirtyChange,
  onDiscardRequest,
}: {
  product: Product;
  step: 'category' | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onDiscardRequest: () => void;
}) {
  const products = useProductViews();
  const options = useCategoryOptions();
  const { forecast } = useProductForecast(product.id);
  const [initial] = useState(() => formFromProduct(product));
  const [form, setForm] = useState<ItemForm>(initial);
  const [submitted, setSubmitted] = useState(false);

  const others = useMemo(() => products.map((p) => p.product), [products]);
  const errors = validateItemForm(form, others, product.id);
  const diff = itemFormDiff(product, form);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    onDirtyChange(dirty);
    setUnsavedChanges(UNSAVED_KEY, dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => setUnsavedChanges(UNSAVED_KEY, false), []);

  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  // An error shows once the field differs from what the sheet opened with, or after «Enregistrer».
  const shown = (key: keyof ItemForm) => submitted || form[key] !== initial[key];

  const save = () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    if (Object.keys(diff).length > 0) tryMutate('product.update', { productId: product.id, fields: diff });
    // A member's category is an override for the whole kind (05 §5.8).
    if (diff.categoryId !== undefined) {
      const kind = diff.kind !== undefined ? diff.kind : product.kind;
      for (const u of propagateCategory({ id: product.id, kind: kind ?? null }, diff.categoryId, others)) {
        tryMutate('product.update', u);
      }
    }
    setUnsavedChanges(UNSAVED_KEY, false);
    closeSheet();
  };

  const cancel = () => (dirty ? onDiscardRequest() : closeSheet());
  const category = options.find((c) => c.id === form.categoryId);
  const computedUsual = forecast?.usualQuantitySource === 'computed' ? forecast.usualQuantity : null;
  const nameError = errors.name && shown('name') ? nameErrorText(errors.name, form.name) : undefined;

  const main = (
    <SheetPage
      title={t('itemEdit.title')}
      leading={<SheetTextButton onPress={cancel}>{t('common.cancel')}</SheetTextButton>}
      trailing={
        <SheetTextButton emphasis disabled={!dirty || hasErrors(errors)} onPress={save}>
          {t('common.save')}
        </SheetTextButton>
      }
    >
      <ListSection header={t('itemEdit.section.item')} footer={t('itemEdit.kind.footer')}>
        <TextField
          label={t('field.name')}
          value={form.name}
          onChange={(v) => set('name', v)}
          error={nameError}
          maxLength={120}
          enterKeyHint="next"
        />
        <TextField
          label={t('field.brand')}
          value={form.brand}
          onChange={(v) => set('brand', v)}
          maxLength={80}
          enterKeyHint="next"
        />
        <ListRow
          variant="navigation"
          title={t('field.category')}
          value={category?.name ?? t('stock.group.noCategory')}
          onPress={() => pushSheetPage({ step: 'category' })}
        />
        <TextField
          label={t('field.kind')}
          value={form.kind}
          onChange={(v) => set('kind', v)}
          placeholder={t('itemEdit.kind.placeholder')}
          maxLength={60}
          enterKeyHint="next"
        />
      </ListSection>

      <ListSection header={t('itemEdit.section.size')}>
        <TextField
          label={t('field.quantity')}
          value={form.size}
          onChange={(v) => set('size', v)}
          inputMode="decimal"
          error={errors.size && shown('size') ? t('validation.sizePositive') : undefined}
        />
        <div className="px-4 py-2">
          <SegmentedControl
            label={t('field.unit')}
            options={FORM_UNITS.map((u) => ({ value: u, label: t(UNIT_LABELS[u]) }))}
            value={form.unit}
            onChange={(u) => set('unit', u)}
          />
        </div>
      </ListSection>

      <ListSection header={t('itemEdit.section.price')}>
        <TextField
          label={t('field.unitPrice')}
          value={form.price}
          onChange={(v) => set('price', v)}
          inputMode="decimal"
          unit="€"
          error={errors.price && shown('price') ? t('validation.pricePositive') : undefined}
        />
      </ListSection>

      <ListSection header={t('item.alert.title')}>
        <ListRow
          variant="plain"
          title={t('item.alert.threshold')}
          subtitle={
            form.minQuantity === null && product.suggestedMin !== null ? (
              <span className="type-caption-1 text-label-tertiary">
                {t('item.alert.suggested', { n: product.suggestedMin })}
              </span>
            ) : undefined
          }
          trailing={
            <QuantityStepper
              value={form.minQuantity ?? forecast?.minimum ?? 0}
              onChange={(v) => set('minQuantity', Math.max(0, Math.round(v)))}
              min={0}
              max={999}
              label={t('item.alert.threshold')}
              decrementLabel={t('a11y.item.remove1')}
              incrementLabel={t('a11y.item.add1')}
              editLabel={t('item.alert.threshold')}
            />
          }
        />
        <ListRow
          variant="plain"
          title={t('item.alert.usual')}
          subtitle={
            form.usualQuantity !== null && computedUsual !== null ? (
              <button
                type="button"
                onClick={() => set('usualQuantity', null)}
                aria-label={t('a11y.itemEdit.reset', { source: t('source.computed') })}
                className="mt-1 inline-flex min-h-8 items-center rounded-full bg-accent-tint px-3 type-footnote text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
              >
                {t('itemEdit.reference', { source: t('source.computed'), value: String(computedUsual) })}
              </button>
            ) : form.usualQuantity === null && computedUsual !== null ? (
              <span className="type-caption-1 text-label-tertiary">{t('source.computed')}</span>
            ) : undefined
          }
          trailing={
            <QuantityStepper
              value={form.usualQuantity ?? computedUsual ?? 0}
              onChange={(v) => set('usualQuantity', Math.max(0, Math.round(v)))}
              min={0}
              max={999}
              label={t('item.alert.usual')}
              decrementLabel={t('a11y.item.remove1')}
              incrementLabel={t('a11y.item.add1')}
              editLabel={t('item.alert.usual')}
            />
          }
        />
      </ListSection>

      {product.gtin ? (
        <ListSection header={t('field.barcode')}>
          <ListRow
            variant="value"
            title={t('field.barcode')}
            value={<span className="font-rounded tabular-nums">{displayBarcode(product.gtin)}</span>}
          />
        </ListSection>
      ) : null}
    </SheetPage>
  );

  const screens: StackScreen[] = [{ key: 'form', element: main }];
  if (step === 'category') {
    screens.push({
      key: 'category',
      element: (
        <CategoryStep
          previousTitle={t('itemEdit.title')}
          value={form.categoryId}
          options={options}
          onChange={(id) => {
            set('categoryId', id);
            popSheetPage();
          }}
        />
      ),
    });
  }
  return (
    <div className="flex h-full">
      <ScreenStack screens={screens} onBack={popSheetPage} />
    </div>
  );
}

/** «Catégorie» push of the edit and new-item sheets. */
export function CategoryStep({
  value,
  options,
  onChange,
  previousTitle,
}: {
  previousTitle: string;
  value: string | null;
  options: readonly CategoryOption[];
  onChange: (id: string) => void;
}) {
  return (
    <SheetPage
      title={t('field.category')}
      leading={
        <BackButton
          previousTitle={previousTitle}
          fallbackLabel={t('common.back')}
          accessibleLabel={t('a11y.home.backTo', { title: previousTitle })}
          onPress={popSheetPage}
        />
      }
    >
      <div className="px-4">
        <CategoryPicker categories={options} value={value} onChange={onChange} label={t('field.category')} />
      </div>
    </SheetPage>
  );
}

function nameErrorText(error: NonNullable<ItemFormErrors['name']>, name: string): string {
  return error === 'required' ? t('validation.nameRequired') : t('validation.nameTaken', { name: name.trim() });
}
