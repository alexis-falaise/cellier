import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { closeSheet, popSheetPage, pushItem, pushSheetPage, setUnsavedChanges } from '@/app/navigation';
import { useActivePantry } from '@/app/session';
import { showToast } from '@/app/toasts';
import type { CategoryId, PantryId, ProductId } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { useProductViews } from '@/entities/product';
import { t } from '@/shared/i18n';
import {
  ListRow,
  ListSection,
  QuantityStepper,
  ScreenStack,
  SheetTextButton,
  type StackScreen,
  TextField,
} from '@/shared/ui';
import { changeStock, tryMutate } from '@/widgets/item/stockActions';
import { CategoryStep, useCategoryOptions } from './ItemEditSheet';
import { matchingProducts, nameTaken } from './model/itemForm';
import { takeNewItemPrefill } from './prefill';
import { SheetPage, stepAndWait } from './ui/SheetPage';

export const NEW_ITEM_UNSAVED_KEY = 'new-item';

/**
 * NewItemSheet (design 03 §4.5.5, `?sheet=new-item[&step=category]`): a product without a barcode.
 * While typing, «Déjà dans le stock» lists matches with a «+1» that adds to the selected cellier.
 */
export function NewItemSheet({
  step,
  onDirtyChange,
  onDiscardRequest,
}: {
  step: 'category' | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onDiscardRequest: () => void;
}) {
  const products = useProductViews();
  const categories = useCategories();
  const options = useCategoryOptions();
  const { pantries, pantry: current } = useActivePantry();
  const [name, setName] = useState(takeNewItemPrefill);
  const others = categories.find((c) => c.templateKey === 'autre')?.id ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pantryId, setPantryId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const chosenCategory = categoryId ?? others;
  const chosenPantry = pantries.find((p) => p.id === pantryId) ?? current ?? pantries[0] ?? null;
  const productList = useMemo(() => products.map((p) => p.product), [products]);
  const taken = nameTaken(name, productList, null);
  const matches = useMemo(
    () =>
      matchingProducts(
        name,
        products.map((p) => p.product),
      ),
    [name, products],
  );
  const dirty = name.trim() !== '' || categoryId !== null || quantity !== 1 || pantryId !== null;

  useEffect(() => {
    onDirtyChange(dirty);
    setUnsavedChanges(NEW_ITEM_UNSAVED_KEY, dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => setUnsavedChanges(NEW_ITEM_UNSAVED_KEY, false), []);

  const error = !name.trim()
    ? submitted
      ? t('validation.nameRequired')
      : undefined
    : taken
      ? t('validation.nameTaken', { name: taken.name })
      : undefined;

  const done = () => {
    setUnsavedChanges(NEW_ITEM_UNSAVED_KEY, false);
    closeSheet();
  };

  const add = () => {
    setSubmitted(true);
    const trimmed = name.trim();
    if (!trimmed || taken || !chosenPantry) return;
    const productId = tryMutate('product.create', {
      productId: crypto.randomUUID() as ProductId,
      name: trimmed,
      categoryId: chosenCategory as CategoryId | null,
    });
    if (!productId) return;
    if (quantity > 0) {
      tryMutate('stock.add', {
        pantryId: chosenPantry.id as PantryId,
        productId: productId as unknown as ProductId,
        quantity,
        source: 'form',
      });
    }
    showToast({ message: t('toast.itemAdded', { product: trimmed, pantry: chosenPantry.name }) });
    done();
  };

  const addOne = (id: string, productName: string) => {
    if (!chosenPantry) return;
    const view = products.find((p) => p.product.id === id);
    const shelf = view?.perPantry.find((r) => r.pantryId === chosenPantry.id)?.quantity ?? 0;
    changeStock(chosenPantry.id, id, 1, shelf, 'form');
    showToast({ message: t('toast.itemAdded', { product: productName, pantry: chosenPantry.name }) });
    done();
  };

  const openExisting = (id: string) => {
    setUnsavedChanges(NEW_ITEM_UNSAVED_KEY, false);
    void stepAndWait(closeSheet).then(() => pushItem(id));
  };

  const category = options.find((c) => c.id === chosenCategory);

  const main = (
    <SheetPage
      title={t('newItem.title')}
      leading={
        <SheetTextButton onPress={() => (dirty ? onDiscardRequest() : closeSheet())}>
          {t('common.cancel')}
        </SheetTextButton>
      }
      trailing={
        <SheetTextButton emphasis disabled={!name.trim() || taken !== null} onPress={add}>
          {t('common.add')}
        </SheetTextButton>
      }
    >
      <ListSection
        label={t('field.name')}
        footer={
          taken ? (
            <button
              type="button"
              onClick={() => openExisting(taken.id)}
              className="min-h-11 text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
            >
              {t('common.open')}
            </button>
          ) : undefined
        }
      >
        <TextField
          label={t('field.name')}
          value={name}
          onChange={setName}
          placeholder={t('newItem.namePlaceholder')}
          error={error}
          maxLength={120}
          autoFocus
          enterKeyHint="done"
        />
      </ListSection>

      {matches.length > 0 && chosenPantry ? (
        <ListSection header={t('newItem.existing')}>
          {matches.map((p) => (
            <ListRow
              key={p.id}
              variant="plain"
              title={p.name}
              trailing={
                <button
                  type="button"
                  aria-label={t('a11y.newItem.addOne', { product: p.name })}
                  onClick={() => addOne(p.id, p.name)}
                  className="flex min-h-11 min-w-11 items-center justify-center gap-0.5 rounded-full text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
                >
                  <Plus size={17} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
                  <span className="font-rounded type-body tabular-nums">1</span>
                </button>
              }
            />
          ))}
        </ListSection>
      ) : null}

      <ListSection label={t('newItem.title')}>
        <ListRow
          variant="navigation"
          title={t('field.category')}
          value={category?.name ?? t('stock.group.noCategory')}
          onPress={() => pushSheetPage({ step: 'category' })}
        />
        <ListRow
          variant="plain"
          title={t('field.quantity')}
          trailing={
            <QuantityStepper
              value={quantity}
              onChange={(v) => setQuantity(Math.max(0, Math.min(999, Math.round(v))))}
              min={0}
              max={999}
              label={t('field.quantity')}
              decrementLabel={t('a11y.item.remove1')}
              incrementLabel={t('a11y.item.add1')}
              editLabel={t('field.quantity')}
            />
          }
        />
      </ListSection>

      {pantries.length >= 2 ? (
        <ListSection header={t('field.pantry')}>
          {pantries.map((p) => (
            <ListRow
              key={p.id}
              variant="value"
              title={p.name}
              selected={p.id === chosenPantry?.id}
              onPress={() => setPantryId(p.id)}
            />
          ))}
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
          previousTitle={t('newItem.title')}
          value={chosenCategory}
          options={options}
          onChange={(id) => {
            setCategoryId(id);
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
