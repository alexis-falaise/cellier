import { m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { openSheet } from '@/app/navigation';
import type { Product } from '@/domain/types';
import type { ProductForecast } from '@/features/forecast';
import { t } from '@/shared/i18n';
import { usePreset } from '@/shared/lib/motion';
import { isStandalone, ListRow, ListSection, QuantityStepper } from '@/shared/ui';
import { tryMutate } from '@/widgets/item/stockActions';
import { suggestedMinimum } from '../model/forecastCard';

const SAVE_MS = 600;

function canAskForPush(): boolean {
  return isStandalone() && typeof Notification !== 'undefined' && Notification.permission === 'default';
}

/**
 * «Alerte» (design 03 §4.6.5): the «seuil» stepper (written after a short pause, one update for a
 * run of taps), the suggestion chip, the usual quantity with its source, and the push prompt row.
 */
export function AlertSection({
  product,
  forecast,
  disabled,
}: {
  product: Product;
  forecast: ProductForecast | undefined;
  disabled: boolean;
}) {
  const stored = product.minQuantity ?? forecast?.minimum ?? 0;
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<number | null>(null);
  const value = draft ?? stored;
  const snappy = usePreset('snappy');

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = latest.current;
    latest.current = null;
    if (next !== null && next !== product.minQuantity) {
      tryMutate('product.update', { productId: product.id, fields: { minQuantity: next } });
    }
    setDraft(null);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  const change = (next: number) => {
    const clamped = Math.max(0, Math.min(999, Math.round(next)));
    latest.current = clamped;
    setDraft(clamped);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_MS);
  };

  const usual = forecast?.usualQuantity ?? product.usualQuantity;
  const suggestion = suggestedMinimum(usual);
  const showSuggestion = !disabled && suggestion !== null && suggestion !== value;
  const usualSource =
    product.usualQuantity !== null
      ? t('source.manual')
      : forecast?.usualQuantitySource === 'computed'
        ? t('source.computed')
        : null;

  return (
    <ListSection
      header={t('item.alert.title')}
      footer={value > 0 ? t('item.alert.footer', { n: value }) : t('item.alert.footerOff')}
    >
      <ListRow
        variant="plain"
        title={t('item.alert.threshold')}
        subtitle={
          showSuggestion ? (
            <m.button
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={snappy}
              onClick={() => change(suggestion)}
              className="mt-1 inline-flex min-h-8 items-center rounded-full bg-accent-tint px-3 type-footnote text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
            >
              {t('item.alert.suggested', { n: suggestion })}
            </m.button>
          ) : undefined
        }
        trailing={
          <QuantityStepper
            value={value}
            onChange={change}
            min={0}
            max={999}
            label={t('item.alert.threshold')}
            decrementLabel={t('a11y.item.remove1')}
            incrementLabel={t('a11y.item.add1')}
            editLabel={t('item.alert.threshold')}
          />
        }
        disabled={disabled}
      />
      <ListRow
        variant="value"
        title={t('item.alert.usual')}
        value={
          usual !== null ? (
            <span className="flex flex-col items-end">
              <span className="font-rounded tabular-nums">{usual}</span>
              {usualSource ? <span className="type-caption-1 text-label-tertiary">{usualSource}</span> : null}
            </span>
          ) : (
            t('common.none')
          )
        }
        disabled={disabled}
        onPress={() => openSheet({ sheet: 'item-edit', id: product.id })}
      />
      {!disabled && canAskForPush() ? (
        <ListRow variant="button" title={t('item.alert.enablePush')} onPress={() => openSheet({ sheet: 'notify' })} />
      ) : null}
    </ListSection>
  );
}
