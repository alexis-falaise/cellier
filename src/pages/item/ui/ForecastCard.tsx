import { t } from '@/shared/i18n';
import type { ForecastBandModel, ForecastCardModel } from '../model/forecastCard';

/** «Prévision» card (design 03 §4.6.4): headline, band with its sentence, confidence line. */
export function ForecastCard({ model }: { model: ForecastCardModel }) {
  return (
    <section aria-labelledby="item-forecast-title" className="mx-4 flex flex-col gap-2">
      <h2 id="item-forecast-title" className="mx-4 type-footnote text-label-secondary">
        {t('item.forecast.title')}
      </h2>
      <div className="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
        <p className="type-title-3 text-label-primary">{model.headline}</p>
        {model.band ? <ForecastBand band={model.band} /> : null}
        {model.sentence ? <p className="type-subhead text-label-primary">{model.sentence}</p> : null}
        {model.note ? <p className="type-footnote text-label-secondary">{model.note}</p> : null}
      </div>
    </section>
  );
}

/** Track from today to latest + 10 %, amber capsule over the 80 % band, a tick at the median. */
function ForecastBand({ band }: { band: ForecastBandModel }) {
  const left = `${band.start * 100}%`;
  const width = `${Math.max(2, (band.end - band.start) * 100)}%`;
  return (
    <div role="img" aria-label={band.accessibleLabel} className="flex flex-col gap-1">
      <div className="relative h-6 rounded-full bg-fill-tertiary">
        <span aria-hidden="true" className="absolute inset-y-0 rounded-full bg-warning-tint" style={{ left, width }} />
        <span
          aria-hidden="true"
          className="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-warning-fg"
          style={{ left: `${band.median * 100}%` }}
        />
      </div>
      <span aria-hidden="true" className="type-caption-2 text-label-secondary">
        {t('history.day.today')}
      </span>
    </div>
  );
}
