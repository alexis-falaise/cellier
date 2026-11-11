import { ArrowLeftRight, EyeOff, Plus } from 'lucide-react';
import type { CategoryKey, ProductView } from '@/domain/types';
import { FOODS_BY_SLUG, type SeasonalGroup, type SeasonalSuggestion } from '@/features/seasonal';
import { t } from '@/shared/i18n';
import {
  CategoryTile,
  type CategoryVisual,
  categoryVisual,
  IconButton,
  ListSection,
  RowSeparator,
  SwipeActions,
} from '@/shared/ui';
import { HomeSection } from '@/widgets/home/HomeSections';

const GROUP_CATEGORY: Record<SeasonalGroup, CategoryKey> = {
  fruits: 'fruits',
  fruits_a_coque: 'fruits',
  legumes: 'legumes',
  herbes: 'legumes',
  mer: 'poisson',
  fromage: 'laitier',
};

const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });

/** «novembre» for a running month index (year × 12 + month − 1). */
export function seasonalMonthName(month: number): string {
  return monthName.format(new Date(Date.UTC(Math.floor(month / 12), month % 12, 15)));
}

/** «de Tomates», «d’Avocats» (elision before a vowel; h is left alone, most food names have an aspirated h). */
export function ofName(name: string): string {
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(name) ? `d’${name}` : `de ${name}`;
}

export function seasonalReasonText(s: SeasonalSuggestion): string {
  if (s.replaces) return t('groceries.seasonal.swap', { ofName: ofName(s.replaces.name) });
  return s.reason === 'back' ? t('groceries.seasonal.back') : t('groceries.seasonal.starting');
}

function visualOf(s: SeasonalSuggestion, viewsById: ReadonlyMap<string, ProductView>): CategoryVisual {
  const category = s.productId ? viewsById.get(s.productId)?.category : null;
  if (category) return categoryVisual(category);
  const group = FOODS_BY_SLUG.get(s.slug)?.group ?? 'legumes';
  return categoryVisual({ templateKey: GROUP_CATEGORY[group] });
}

function SeasonalRow({
  suggestion,
  visual,
  onAdd,
  onHide,
}: {
  suggestion: SeasonalSuggestion;
  visual: CategoryVisual;
  onAdd: () => void;
  onHide: () => void;
}) {
  const swap = suggestion.replaces;
  return (
    <SwipeActions
      trailing={[{ label: t('common.hide'), icon: EyeOff, tone: 'neutral', onAction: onHide, removesRow: true }]}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list */}
      <div role="listitem" className="relative flex min-h-14 items-center gap-3 py-2.5 pr-2 pl-4">
        <CategoryTile visual={visual} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body text-label-primary">{suggestion.name}</span>
          <span className="truncate type-subhead text-label-secondary">{seasonalReasonText(suggestion)}</span>
        </span>
        <IconButton
          icon={swap ? ArrowLeftRight : Plus}
          tone="accent"
          label={
            swap
              ? t('a11y.groceries.seasonal.swap', { replaced: swap.name, name: suggestion.name })
              : t('a11y.groceries.seasonal.add', { name: suggestion.name })
          }
          onClick={onAdd}
        />
        <RowSeparator inset={64} />
      </div>
    </SwipeActions>
  );
}

export interface SeasonalSectionProps {
  month: number;
  suggestions: readonly SeasonalSuggestion[];
  viewsById: ReadonlyMap<string, ProductView>;
  onAdd: (s: SeasonalSuggestion) => void;
  onHide: (s: SeasonalSuggestion) => void;
}

/**
 * «De saison en {mois}»: in-season swaps for out-of-season rows, foods back in season and foods whose
 * season starts. Not part of the list until added («+», or «⇄» which also takes the replaced row off).
 */
export function SeasonalSection({ month, suggestions, viewsById, onAdd, onHide }: SeasonalSectionProps) {
  if (suggestions.length === 0) return null;
  const title = t('groceries.seasonal.title', { month: seasonalMonthName(month) });
  return (
    <HomeSection title={title}>
      <ListSection label={title} footer={t('groceries.seasonal.source')}>
        {suggestions.map((s) => (
          <SeasonalRow
            key={s.slug}
            suggestion={s}
            visual={visualOf(s, viewsById)}
            onAdd={() => onAdd(s)}
            onHide={() => onHide(s)}
          />
        ))}
      </ListSection>
    </HomeSection>
  );
}
