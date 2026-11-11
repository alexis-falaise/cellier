import { useState } from 'react';
import { type MessageKey, type MessageParams, t } from '@/shared/i18n';
import { cx, ListSection, RowSeparator } from '@/shared/ui';
import {
  allergenName,
  analysisChips,
  type EcoScoreGrade,
  LEVEL_KEYS,
  type NovaGroup,
  NUTRIMENT_KEYS,
  type NutrientLevel,
  type NutrimentKey,
  type NutriScoreGrade,
  type ProductFacts,
  visibleLabels,
} from '../model/facts';

/** Official scale colours (Nutri-Score, NOVA, Green-Score); fixed in both themes like the printed logos. */
const NUTRI_COLORS: Record<NutriScoreGrade, [string, string]> = {
  a: ['#038141', '#fff'],
  b: ['#85BB2F', '#fff'],
  c: ['#FECB02', '#1d1d1b'],
  d: ['#EE8100', '#fff'],
  e: ['#E63E11', '#fff'],
};
const NOVA_COLORS: Record<NovaGroup, [string, string]> = {
  1: ['#00AA00', '#fff'],
  2: ['#FFCC00', '#1d1d1b'],
  3: ['#FF6600', '#fff'],
  4: ['#FF0000', '#fff'],
};
const ECO_COLORS: Record<EcoScoreGrade, [string, string]> = {
  'a-plus': ['#1E8F4E', '#fff'],
  a: ['#2E9E5B', '#fff'],
  b: ['#60AC0E', '#fff'],
  c: ['#EEAE0E', '#1d1d1b'],
  d: ['#FF6F1E', '#fff'],
  e: ['#DF1F1F', '#fff'],
  f: ['#B11E1E', '#fff'],
};
const LEVEL_DOT: Record<NutrientLevel, string> = {
  low: '#038141',
  moderate: '#EE8100',
  high: '#E63E11',
};

type Unit = 'g' | 'ml' | 'piece' | null;
/** Keys without placeholders, for keys built from a grade or nutrient name. */
type PlainKey = { [K in MessageKey]: keyof MessageParams<K> extends never ? K : never }[MessageKey];

export interface ProductFactsSectionsProps {
  facts: ProductFacts;
  /** The household product's unit: liquids read «pour 100 ml». */
  netUnit: Unit;
}

/** «Qualité», «Repères nutritionnels», «Valeurs nutritionnelles», «Composition». */
export function ProductFactsSections({ facts, netUnit }: ProductFactsSectionsProps) {
  return (
    <>
      <GradesSection facts={facts} />
      <LevelsSection facts={facts} />
      <NutritionSection facts={facts} netUnit={netUnit} />
      <CompositionSection facts={facts} />
    </>
  );
}

function GradesSection({ facts }: { facts: ProductFacts }) {
  const tiles: TileProps[] = [];
  if (facts.nutriscore) {
    tiles.push({
      score: t('facts.nutriscore'),
      grade: facts.nutriscore.toUpperCase(),
      colors: NUTRI_COLORS[facts.nutriscore],
      meaning: t(`facts.nutriscore.${facts.nutriscore}` as PlainKey),
    });
  }
  if (facts.nova) {
    tiles.push({
      score: t('facts.nova'),
      grade: String(facts.nova),
      colors: NOVA_COLORS[facts.nova],
      meaning: t(`facts.nova.${facts.nova}` as PlainKey),
    });
  }
  if (facts.ecoscore) {
    tiles.push({
      score: t('facts.ecoscore'),
      grade: facts.ecoscore === 'a-plus' ? 'A+' : facts.ecoscore.toUpperCase(),
      colors: ECO_COLORS[facts.ecoscore],
      meaning: t(`facts.ecoscore.${facts.ecoscore}` as PlainKey),
    });
  }
  if (tiles.length === 0) return null;
  return (
    <section aria-labelledby="item-facts-quality" className="mx-4 flex flex-col gap-2">
      <h2 id="item-facts-quality" className="mx-4 type-footnote text-label-secondary">
        {t('facts.quality.title')}
      </h2>
      <div
        className={cx(
          'grid gap-2',
          tiles.length === 1 ? 'grid-cols-1' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
        )}
      >
        {tiles.map((tile) => (
          <GradeTile key={tile.score} {...tile} />
        ))}
      </div>
    </section>
  );
}

interface TileProps {
  score: string;
  grade: string;
  colors: [string, string];
  meaning: string;
}

function GradeTile({ score, grade, colors, meaning }: TileProps) {
  return (
    <div
      role="img"
      aria-label={t('a11y.facts.grade', { score, grade, meaning })}
      className="flex min-w-0 flex-col items-start gap-2 rounded-md border border-edge bg-surface p-3"
    >
      <span className="type-caption-1 text-label-secondary">{score}</span>
      <span
        aria-hidden="true"
        className="inline-flex size-11 items-center justify-center rounded-sm font-rounded text-[22px] leading-none font-bold"
        style={{ backgroundColor: colors[0], color: colors[1] }}
      >
        {grade}
      </span>
      <span aria-hidden="true" className="type-caption-1 text-pretty text-label-primary">
        {meaning}
      </span>
    </div>
  );
}

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmtSmall = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function amount(key: NutrimentKey, value: number): string {
  if (key === 'energy_kcal') return `${fmt.format(value)} kcal`;
  return `${(value < 1 ? fmtSmall : fmt).format(value)} g`;
}

function LevelsSection({ facts }: { facts: ProductFacts }) {
  const keys = LEVEL_KEYS.filter((k) => facts.levels[k]);
  if (keys.length === 0) return null;
  return (
    <ListSection header={t('facts.levels.title')} footer={t('facts.levels.footer')}>
      {keys.map((k) => {
        const level = facts.levels[k] as NutrientLevel;
        const value = facts.nutriments[k];
        return (
          <FactRow
            key={k}
            leading={
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: LEVEL_DOT[level] }}
              />
            }
            label={t(`facts.nutrient.${k}` as PlainKey)
              .replace(/^dont /, '')
              .replace(/^./, (c) => c.toUpperCase())}
            value={t(`facts.level.${level}` as PlainKey)}
            caption={value !== undefined ? amount(k, value) : null}
          />
        );
      })}
    </ListSection>
  );
}

function NutritionSection({ facts, netUnit }: { facts: ProductFacts; netUnit: Unit }) {
  const keys = NUTRIMENT_KEYS.filter((k) => facts.nutriments[k] !== undefined);
  if (keys.length === 0) return null;
  return (
    <ListSection
      header={`${t('facts.nutrition.title')} · ${t(netUnit === 'ml' ? 'facts.nutrition.per100ml' : 'facts.nutrition.per100g').toLowerCase()}`}
    >
      {keys.map((k) => {
        const sub = k === 'saturated_fat' || k === 'sugars';
        return (
          <FactRow
            key={k}
            label={t(`facts.nutrient.${k}` as PlainKey)}
            value={<span className="font-rounded tabular-nums">{amount(k, facts.nutriments[k] as number)}</span>}
            indent={sub}
          />
        );
      })}
    </ListSection>
  );
}

function CompositionSection({ facts }: { facts: ProductFacts }) {
  const chips = analysisChips(facts);
  const labels = visibleLabels(facts).filter((l) => !chips.some((c) => c.label === l));
  const rows: { key: string; label: string; value: string }[] = [];
  if (facts.allergens.length > 0) {
    rows.push({ key: 'allergens', label: t('facts.allergens'), value: facts.allergens.map(allergenName).join(', ') });
  }
  if (facts.traces.length > 0) {
    rows.push({ key: 'traces', label: t('facts.traces'), value: facts.traces.map(allergenName).join(', ') });
  }
  if (facts.additives.length > 0) {
    rows.push({
      key: 'additives',
      label: t('facts.additives', { n: facts.additives.length }),
      value: facts.additives.join(', '),
    });
  } else if (facts.source === 'off' && facts.ingredients) {
    rows.push({ key: 'additives', label: t('facts.additives.none'), value: '' });
  }
  if (facts.origins) rows.push({ key: 'origins', label: t('facts.origins'), value: facts.origins });
  if (facts.afterOpeningMonths) {
    rows.push({
      key: 'pao',
      label: t('facts.afterOpening'),
      value: t('facts.afterOpening.months', { n: facts.afterOpeningMonths }),
    });
  }
  if (rows.length === 0 && chips.length === 0 && labels.length === 0 && !facts.ingredients) return null;

  return (
    <ListSection header={t('facts.composition.title')}>
      {chips.length > 0 || labels.length > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
        <div role="listitem" className="relative flex flex-wrap gap-1.5 px-4 py-3" aria-label={t('facts.labels')}>
          {chips.map((c) => (
            <Chip key={c.key} tone={c.tone}>
              {c.label}
            </Chip>
          ))}
          {labels.map((l) => (
            <Chip key={l} tone="neutral">
              {l}
            </Chip>
          ))}
          <RowSeparator inset={16} />
        </div>
      ) : null}
      {rows.map((r) => (
        <FactRow key={r.key} label={r.label} value={r.value} stacked={r.value.length > 28} />
      ))}
      {facts.ingredients ? <IngredientsRow text={facts.ingredients} /> : null}
    </ListSection>
  );
}

function Chip({ children, tone }: { children: string; tone: 'positive' | 'warning' | 'neutral' }) {
  return (
    <span
      className={cx(
        'inline-flex min-h-7 items-center rounded-full px-2.5 type-footnote',
        tone === 'positive'
          ? 'bg-success-tint text-success-fg'
          : tone === 'warning'
            ? 'bg-warning-tint text-warning-fg'
            : 'bg-fill-tertiary text-label-primary',
      )}
    >
      {children}
    </span>
  );
}

interface FactRowProps {
  label: string;
  value: React.ReactNode;
  caption?: string | null;
  leading?: React.ReactNode;
  indent?: boolean;
  /** Long values go under the label instead of beside it. */
  stacked?: boolean;
}

function FactRow({ label, value, caption, leading, indent = false, stacked = false }: FactRowProps) {
  if (stacked) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
      <div role="listitem" className="relative flex flex-col gap-0.5 px-4 py-3">
        <span className="type-body text-label-primary">{label}</span>
        <span className="type-subhead text-pretty text-label-secondary">{value}</span>
        <RowSeparator inset={16} />
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
    <div
      role="listitem"
      className={cx('relative flex min-h-11 items-center gap-3 py-2.5 pr-4', indent ? 'pl-8' : 'pl-4')}
    >
      {leading}
      <span
        className={cx('min-w-0 flex-1', indent ? 'type-subhead text-label-secondary' : 'type-body text-label-primary')}
      >
        {label}
      </span>
      <span className="flex shrink-0 flex-col items-end text-right">
        <span className="type-body text-label-secondary">{value}</span>
        {caption ? <span className="type-caption-1 text-label-tertiary">{caption}</span> : null}
      </span>
      <RowSeparator inset={indent ? 32 : 16} />
    </div>
  );
}

const CLAMP_AT = 220;

function IngredientsRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_AT;
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
    <div role="listitem" className="relative flex flex-col gap-1 px-4 py-3">
      <span className="type-body text-label-primary">{t('facts.ingredients')}</span>
      <p className={cx('type-subhead text-pretty text-label-secondary', long && !open && 'line-clamp-4')}>{text}</p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="-my-2 inline-flex min-h-11 items-center self-start type-subhead text-accent-fg outline-none focus-visible:focus-ring"
        >
          {open ? t('facts.ingredients.less') : t('facts.ingredients.more')}
        </button>
      ) : null}
      <RowSeparator inset={16} />
    </div>
  );
}
