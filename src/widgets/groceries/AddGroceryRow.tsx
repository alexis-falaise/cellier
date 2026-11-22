import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProductId } from '@/domain/types';
import { fold, t } from '@/shared/i18n';
import { CategoryTile, categoryVisual, ListRow, ListSection, RowSeparator } from '@/shared/ui';
import { type GroceryAddOption, matchAddOptions } from './model/addOptions';

export interface AddGroceryRowProps {
  /** One choice per line of the list (`groceryAddOptions`): a kind once, else a product. */
  options: readonly GroceryAddOption[];
  /** Products already on the list (with the rest of their kind), not offered again. */
  listed: ReadonlySet<string>;
  onAddProduct: (productId: ProductId) => void;
  onAddLabel: (label: string) => void;
  /** Controlled: the empty state's «Ajouter un article» opens the field too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * «Ajouter un article» (design 03 §4.8.2): the row turns into a text field; matching household
 * products are offered below by what they are (a kind once, a linked entry), then «Ajouter « q »»
 * for a free-text entry.
 */
export function AddGroceryRow({ options, listed, onAddProduct, onAddLabel, open, onOpenChange }: AddGroceryRowProps) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => matchAddOptions(options, query, listed), [options, query, listed]);
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
    const exact = matches.find((o) => o.terms.includes(fold(trimmed)));
    if (exact) onAddProduct(exact.productId);
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
      {matches.map((o) => (
        <ListRow
          key={o.productId}
          variant="value"
          title={o.name}
          leading={<CategoryTile visual={categoryVisual(o.category ?? {})} size={28} />}
          onPress={() => {
            onAddProduct(o.productId);
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
