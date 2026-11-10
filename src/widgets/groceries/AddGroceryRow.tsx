import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProductId, ProductView } from '@/domain/types';
import { fold, t } from '@/shared/i18n';
import { CategoryTile, categoryVisual, ListRow, ListSection, RowSeparator } from '@/shared/ui';

const MAX_MATCHES = 5;

export interface AddGroceryRowProps {
  products: readonly ProductView[];
  /** Products already on the list, not offered again. */
  listed: ReadonlySet<string>;
  onAddProduct: (productId: ProductId) => void;
  onAddLabel: (label: string) => void;
  /** Controlled: the empty state's «Ajouter un article» opens the field too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Up to five household products whose folded name contains the folded query, prefix matches first. */
export function matchProducts(
  products: readonly ProductView[],
  query: string,
  listed: ReadonlySet<string>,
): ProductView[] {
  const q = fold(query.trim());
  if (!q) return [];
  const prefix: ProductView[] = [];
  const inner: ProductView[] = [];
  for (const v of products) {
    if (listed.has(v.product.id)) continue;
    const name = fold(v.product.name);
    if (name.startsWith(q)) prefix.push(v);
    else if (name.includes(q)) inner.push(v);
    if (prefix.length >= MAX_MATCHES) break;
  }
  return [...prefix, ...inner].slice(0, MAX_MATCHES);
}

/**
 * «Ajouter un article» (design 03 §4.8.2): the row turns into a text field; matching household
 * products are offered below (a linked entry), then «Ajouter « q »» for a free-text entry.
 */
export function AddGroceryRow({ products, listed, onAddProduct, onAddLabel, open, onOpenChange }: AddGroceryRowProps) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => matchProducts(products, query, listed), [products, query, listed]);
  const trimmed = query.trim();

  const close = () => {
    onOpenChange(false);
    setQuery('');
  };

  if (!open) {
    return (
      <ListSection label={t('groceries.add')}>
        <ListRow variant="button" icon={Plus} title={t('groceries.add')} onPress={() => onOpenChange(true)} />
      </ListSection>
    );
  }

  const submit = () => {
    if (!trimmed) {
      close();
      return;
    }
    const exact = matches.find((v) => fold(v.product.name) === fold(trimmed));
    if (exact) onAddProduct(exact.product.id);
    else onAddLabel(trimmed);
    close();
  };

  return (
    <ListSection label={t('groceries.add')}>
      {/* Inset focus ring whenever the field is focused, rounded like the section's clip (as in TextField). */}
      {/* biome-ignore lint/a11y/useSemanticElements: rows of an inset list, not direct li elements */}
      <div
        role="listitem"
        className="relative row-corners flex min-h-[52px] items-center gap-3 px-4 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-focus-ring"
      >
        <Plus size={20} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0 text-accent-fg" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the field replaces the row the user just tapped
          autoFocus
          type="text"
          value={query}
          maxLength={80}
          enterKeyHint="done"
          autoComplete="off"
          aria-label={t('groceries.add.placeholder')}
          placeholder={t('groceries.add.placeholder')}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              close();
            }
          }}
          onBlur={() => {
            if (!trimmed) close();
          }}
          className="min-w-0 flex-1 bg-transparent type-body text-label-primary outline-none placeholder:text-label-tertiary"
        />
        <RowSeparator inset={16} />
      </div>
      {matches.map((v) => (
        <ListRow
          key={v.product.id}
          variant="value"
          title={v.product.name}
          leading={<CategoryTile visual={categoryVisual(v.category ?? {})} size={28} />}
          onPress={() => {
            onAddProduct(v.product.id);
            close();
          }}
        />
      ))}
      {trimmed ? (
        <ListRow
          variant="button"
          icon={Plus}
          title={t('groceries.add.freeText', { q: trimmed })}
          onPress={() => {
            onAddLabel(trimmed);
            close();
          }}
        />
      ) : null}
    </ListSection>
  );
}
