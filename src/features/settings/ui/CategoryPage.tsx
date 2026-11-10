import { type ReactNode, useState } from 'react';
import { openConfirm, popSheetPage, useOverlay } from '@/app/navigation';
import type { Category, CategoryId } from '@/domain/types';
import { useCategories, useDeletedCategories } from '@/entities/category';
import { useIsOwner } from '@/entities/member';
import { useProductViews } from '@/entities/product';
import { t } from '@/shared/i18n';
import { useMutate } from '@/shared/sync';
import {
  CATEGORY_HUES,
  type CategoryHue,
  type CategoryIconName,
  CategoryTile,
  ColorSwatchPicker,
  ConfirmDialog,
  categoryVisual,
  IconPicker,
  ListRow,
  ListSection,
  SheetTextButton,
  TextField,
} from '@/shared/ui';
import {
  type CategoryNameError,
  categoryKind,
  nextSortOrder,
  productsToReassign,
  validateCategoryName,
} from '../model/categories';
import type { PlainMessageKey } from '../model/pages';
import { closeConfirmAndWait, PageLayout } from './common';

const DELETE = 'category-delete';

const NAME_ERRORS: Record<CategoryNameError, PlainMessageKey> = {
  required: 'validation.categoryRequired',
  taken: 'validation.categoryTaken',
};

const HUE_LABELS = Object.fromEntries(CATEGORY_HUES.map((hue) => [hue, t(`category.hue.${hue}`)])) as Record<
  CategoryHue,
  string
>;

interface Appearance {
  name: string;
  icon: CategoryIconName;
  hue: CategoryHue;
}

function Editor({
  value,
  error,
  onName,
  onNameBlur,
  onIcon,
  onHue,
}: {
  value: Appearance;
  error: string | undefined;
  onName: (name: string) => void;
  onNameBlur?: (() => void) | undefined;
  onIcon: (icon: CategoryIconName) => void;
  onHue: (hue: CategoryHue) => void;
}) {
  return (
    <>
      <div className="flex justify-center">
        <CategoryTile icon={categoryVisual({ icon: value.icon }).icon} hue={value.hue} size={64} label={value.name} />
      </div>
      <ListSection label={t('field.name')}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: focus and blur bubble from the field's input */}
        <div onBlur={onNameBlur}>
          <TextField
            label={t('field.name')}
            value={value.name}
            onChange={onName}
            maxLength={60}
            enterKeyHint="done"
            error={error}
          />
        </div>
      </ListSection>
      <section className="flex flex-col gap-2">
        <h2 className="mx-8 type-footnote text-label-secondary">{t('category.icon')}</h2>
        <IconPicker value={value.icon} hue={value.hue} onChange={onIcon} label={t('category.icon')} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="mx-8 type-footnote text-label-secondary">{t('category.color')}</h2>
        <ColorSwatchPicker value={value.hue} onChange={onHue} hueLabels={HUE_LABELS} label={t('category.color')} />
      </section>
    </>
  );
}

/** Nouvelle catégorie (03 §4.13.2): «Annuler» / «Créer». */
export function NewCategoryPage() {
  const categories = useCategories();
  const mutate = useMutate();
  const base = categoryVisual({});
  const [draft, setDraft] = useState<Appearance>({ name: '', icon: base.iconName, hue: base.hue });
  const [touched, setTouched] = useState(false);
  const problem = validateCategoryName(draft.name, categories, null);

  const create = () => {
    setTouched(true);
    if (problem) return;
    mutate('category.create', {
      categoryId: crypto.randomUUID() as CategoryId,
      name: draft.name.trim(),
      icon: draft.icon,
      color: draft.hue,
      sortOrder: nextSortOrder(categories),
    });
    popSheetPage();
  };

  return (
    <PageLayout
      page="category-new"
      leading={<SheetTextButton onPress={popSheetPage}>{t('common.cancel')}</SheetTextButton>}
      trailing={
        <SheetTextButton emphasis disabled={problem === 'required'} onPress={create}>
          {t('common.create')}
        </SheetTextButton>
      }
    >
      <Editor
        value={draft}
        error={touched && problem ? t(NAME_ERRORS[problem]) : undefined}
        onName={(name) => setDraft({ ...draft, name })}
        onIcon={(icon) => setDraft({ ...draft, icon })}
        onHue={(hue) => setDraft({ ...draft, hue })}
      />
    </PageLayout>
  );
}

/** A category (03 §4.13.2): name saved on blur, icon and colour saved on tap, hide / show / delete. */
export function CategoryPage({ categoryId }: { categoryId: string }) {
  const live = useCategories();
  const deleted = useDeletedCategories();
  const found = live.find((c) => c.id === categoryId) ?? deleted.find((c) => c.id === categoryId);
  const [last, setLast] = useState<Category | undefined>(found);
  if (found && found !== last) setLast(found);
  const category = found ?? last;
  if (!category) return <PageLayout page="category">{null}</PageLayout>;
  return <CategoryDetail key={category.id} category={category} live={live} />;
}

function CategoryDetail({ category, live }: { category: Category; live: readonly Category[] }) {
  const mutate = useMutate();
  const isOwner = useIsOwner();
  const overlay = useOverlay();
  const products = useProductViews();
  const visual = categoryVisual(category);
  const [name, setName] = useState(category.name);
  const hidden = category.deletedAt !== null;
  const kind = categoryKind(category);
  const problem = validateCategoryName(name, live, category.id);
  const inCategory = productsToReassign(
    category.id,
    products.map((p) => p.product),
  );

  const update = (fields: { name?: string; icon?: string; color?: string }) => {
    if (hidden) return;
    mutate('category.update', { categoryId: category.id, fields });
  };

  const saveName = () => {
    const next = name.trim();
    if (problem || next === category.name) {
      if (problem) setName(category.name);
      return;
    }
    update({ name: next });
  };

  const remove = async () => {
    await closeConfirmAndWait();
    // «Ses {n} articles passeront dans « Autres »»: move them first, then tombstone the category.
    const others = live.find((c) => c.templateKey === 'autre');
    if (others) {
      for (const productId of inCategory) {
        mutate('product.update', { productId, fields: { categoryId: others.id } });
      }
    }
    mutate('category.delete', { categoryId: category.id });
    popSheetPage();
  };

  let actions: { row: ReactNode; footer: string } | null = null;
  if (kind === 'others') {
    actions = { row: null, footer: t('category.othersFooter') };
  } else if (kind === 'default') {
    actions = {
      row: hidden ? (
        <ListRow
          variant="button"
          title={t('category.show')}
          onPress={() => mutate('category.restore', { categoryId: category.id })}
        />
      ) : (
        <ListRow
          variant="button"
          title={t('category.hide')}
          onPress={() => mutate('category.delete', { categoryId: category.id })}
        />
      ),
      footer: t('category.defaultFooter'),
    };
  } else if (isOwner) {
    actions = {
      row: <ListRow variant="destructive" title={t('category.delete')} onPress={() => openConfirm(DELETE)} />,
      footer: '',
    };
  } else {
    actions = { row: null, footer: t('category.memberFooter') };
  }

  return (
    <PageLayout page="category" title={category.name}>
      <Editor
        value={{ name, icon: visual.iconName, hue: visual.hue }}
        error={problem ? t(NAME_ERRORS[problem]) : undefined}
        onName={setName}
        onNameBlur={saveName}
        onIcon={(icon) => update({ icon })}
        onHue={(hue) => update({ color: hue })}
      />
      {actions.row ? (
        <ListSection label={category.name} footer={actions.footer || undefined}>
          {actions.row}
        </ListSection>
      ) : (
        <p className="mx-8 -mt-6 type-footnote text-label-secondary">{actions.footer}</p>
      )}

      <ConfirmDialog
        open={overlay.confirm === DELETE}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('category.delete.title', { name: category.name })}
        message={inCategory.length > 0 ? t('category.delete.message', { n: inCategory.length }) : undefined}
        actions={[{ label: t('common.delete'), destructive: true, onPress: () => void remove() }]}
        cancelLabel={t('common.cancel')}
      />
    </PageLayout>
  );
}
