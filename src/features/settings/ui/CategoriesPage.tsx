import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { pushSheetPage } from '@/app/navigation';
import type { Category } from '@/domain/types';
import { useCategories, useDeletedCategories } from '@/entities/category';
import { useProductViews } from '@/entities/product';
import { t } from '@/shared/i18n';
import { useMutate } from '@/shared/sync';
import { CategoryTile, categoryVisual, ListRow, ListSection, SheetTextButton } from '@/shared/ui';
import { reorderPlan } from '../model/categories';
import { PageLayout, RowIcon } from './common';
import { ReorderList } from './ReorderList';

function useCategoryCounts(): ReadonlyMap<string, number> {
  const products = useProductViews();
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const id = p.product.categoryId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [products]);
}

function CategoryLeading({ category }: { category: Category }) {
  return <CategoryTile visual={categoryVisual(category)} size={28} />;
}

/**
 * Catégories (03 §4.13.1): the household's categories in Courses order, with their icon and colour;
 * «Modifier» switches to reorder mode; hidden default categories are listed apart.
 */
export function CategoriesPage() {
  const categories = useCategories();
  const hidden = useDeletedCategories().filter((c) => c.templateKey !== null);
  const counts = useCategoryCounts();
  const mutate = useMutate();
  const [editing, setEditing] = useState(false);

  const move = (from: number, to: number) => {
    for (const update of reorderPlan(categories, from, to)) {
      mutate('category.update', { categoryId: update.id, fields: { sortOrder: update.sortOrder } });
    }
  };

  return (
    <PageLayout
      page="categories"
      trailing={
        <SheetTextButton emphasis={editing} onPress={() => setEditing(!editing)}>
          {editing ? t('common.done') : t('common.edit')}
        </SheetTextButton>
      }
    >
      <ListSection header={t('categories.title')} footer={t('categories.footer')}>
        {editing ? (
          <ReorderList
            items={categories}
            getId={(c) => c.id}
            handleLabel={(c) => t('categories.move', { name: c.name })}
            handleHint={t('categories.moveHint')}
            onMove={move}
            renderRow={(c, handle) => (
              <ListRow variant="plain" leading={<CategoryLeading category={c} />} title={c.name} trailing={handle} />
            )}
          />
        ) : (
          <>
            {categories.map((c) => (
              <ListRow
                key={c.id}
                leading={<CategoryLeading category={c} />}
                title={c.name}
                value={String(counts.get(c.id) ?? 0)}
                onPress={() => pushSheetPage({ page: 'category', id: c.id })}
              />
            ))}
            <ListRow
              variant="button"
              leading={<RowIcon icon={Plus} tone="accent" />}
              title={t('categories.new')}
              onPress={() => pushSheetPage({ page: 'category-new' })}
            />
          </>
        )}
      </ListSection>

      {hidden.length > 0 && !editing ? (
        <ListSection header={t('categories.hidden')}>
          {hidden.map((c) => (
            <ListRow
              key={c.id}
              leading={<CategoryLeading category={c} />}
              title={c.name}
              onPress={() => pushSheetPage({ page: 'category', id: c.id })}
            />
          ))}
        </ListSection>
      ) : null}
    </PageLayout>
  );
}
