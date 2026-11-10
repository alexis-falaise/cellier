/**
 * Text and grouping for the next trip and the Courses list (design 03 §4.2.4, §4.8). Pure: every
 * clock-dependent function takes `now`.
 */
import type { Category } from '@/domain/types';
import type { GroceryItem, NextTrip, ProductForecast } from '@/features/forecast';
import { formatDayMonth, formatShortDate, t } from '@/shared/i18n';
import { type CategoryHue, categoryVisual } from '@/shared/ui/categories';

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Calendar days from `now` to `date`, local time. */
export function calendarDaysBetween(now: Date, date: Date): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

/** Monday of the local week containing `date`. */
function mondayOf(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

/** «samedi 16 nov.» → «Samedi 16 nov.» (a date standing alone as a title). */
export function capitalize(text: string): string {
  return text.length > 0 ? text.charAt(0).toLocaleUpperCase('fr') + text.slice(1) : text;
}

const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' });

/** French weekday name of a cadence weekday (0 = Sunday … 6 = Saturday). */
export function weekdayName(day: number): string {
  // 7 January 2024 was a Sunday.
  return weekdayFormat.format(new Date(Date.UTC(2024, 0, 7 + day, 12)));
}

/**
 * Date line of the next trip (§4.2.4): «aujourd’hui», «demain», then by cadence confidence
 * «samedi 16 nov.», «vers samedi 16 nov.», or «cette semaine» / «la semaine prochaine» / «semaine du 25 nov.».
 */
export function tripDateText(trip: NextTrip, now: number): string {
  const date = new Date(trip.tripAt);
  const today = new Date(now);
  const days = calendarDaysBetween(today, date);
  if (days <= 0) return t('time.today');
  if (days === 1) return t('time.tomorrow');
  const confidence = trip.cadence?.confidence ?? 'low';
  if (confidence === 'high') return formatShortDate(date);
  if (confidence === 'medium') return t('trip.date.approx', { date: formatShortDate(date) });
  const weeks = Math.round((mondayOf(date).getTime() - mondayOf(today).getTime()) / (7 * DAY_MS));
  if (weeks <= 0) return t('trip.date.thisWeek');
  if (weeks === 1) return t('trip.date.nextWeek');
  return t('trip.date.weekOf', { date: formatDayMonth(mondayOf(date), today) });
}

/** Explanation line of the next trip (§4.2.4), first matching case. */
export function tripReasonText(trip: NextTrip, forecasts: readonly ProductForecast[]): string {
  if (trip.pulledForward) {
    const n = forecasts.filter(
      (f) => !f.deleted && f.lowAlert && f.runOut !== null && f.runOut.median <= trip.tripAt,
    ).length;
    return t('trip.reason.pulledForward', { n: Math.max(1, n) });
  }
  const cadence = trip.cadence;
  if (cadence?.confidence === 'high' && cadence.usualWeekdayShare >= 0.5) {
    return t('trip.reason.cadenceWeekday', {
      weekday: weekdayName(cadence.usualWeekday),
      g: Math.max(1, Math.round(cadence.medianGapDays)),
    });
  }
  if (cadence && cadence.confidence !== 'low') return t('trip.reason.cadence', { n: Math.min(cadence.sessions, 12) });
  return t('trip.reason.thin');
}

/** True while dates and quantities are still rough (no cadence or a low-confidence one). */
export function isThin(trip: NextTrip): boolean {
  return trip.cadence === null || trip.cadence.confidence === 'low';
}

const listFormat = new Intl.ListFormat('fr', { style: 'long', type: 'conjunction' });

/** «Lait, Café et Pâtes», or «Lait, Café, Pâtes et 4 autres» beyond three names (`trip.preview`). */
export function tripPreview(names: readonly string[]): string {
  if (names.length <= 3) return listFormat.format(names);
  const [a = '', b = '', c = ''] = names;
  return t('trip.preview', { a, b, c, n: names.length - 3 });
}

export function itemName(item: GroceryItem): string {
  return item.kind === 'product' ? item.name : item.label;
}

/** «Ajouté par …» for manual rows; `member` is already resolved («vous» for the current user). */
export function groceryReasonText(
  item: GroceryItem,
  forecast: ProductForecast | undefined,
  member: string,
  now: number,
): string {
  if (item.kind === 'label') return t('groceries.reason.freeText', { member });
  const qty = item.totalQuantity ?? 0;
  switch (item.reason) {
    case 'out':
      return t('forecast.badge.out');
    case 'threshold':
      return t('groceries.reason.threshold', { qty, seuil: forecast?.minimum ?? 0 });
    case 'forecast':
      return t('groceries.reason.cover', { qty, d: Math.max(1, Math.round(forecast?.daysLeft ?? 1)) });
    case 'before-next-trip':
      return item.runOut
        ? t('groceries.reason.runOut', { date: formatDayMonth(new Date(item.runOut.median), new Date(now)) })
        : t('groceries.reason.manual', { member });
    default:
      break;
  }
  // Checked rows and manual rows: still say why when the product is low, else who added it.
  if (forecast?.runningLow && item.checked) {
    if (forecast.totalQuantity <= 0) return t('forecast.badge.out');
    if (forecast.lowByThreshold) return t('groceries.reason.threshold', { qty, seuil: forecast.minimum });
  }
  return t('groceries.reason.manual', { member });
}

export interface GrocerySection {
  key: string;
  title: string;
  hue: CategoryHue;
  items: GroceryItem[];
}

const OTHER_KEY = 'autre';

/**
 * Groups rows by category in the household's category order (§4.8.1). Products without a category
 * and free-text rows go to «Autre» (the household's `autre` category when it exists), last.
 * Rows keep their order inside a section (suggestions by urgency, then manual rows).
 */
export function groupByCategory(
  items: readonly GroceryItem[],
  categoryOf: (productId: string) => Category | null,
  categories: readonly Category[],
): GrocerySection[] {
  const other = categories.find((c) => c.templateKey === OTHER_KEY) ?? null;
  const order = new Map(categories.filter((c) => c !== other).map((c, i) => [c.id as string, i]));
  const sections = new Map<string, GrocerySection>();
  for (const item of items) {
    const category = item.kind === 'product' ? categoryOf(item.productId) : null;
    const known = category && category !== other && order.has(category.id) ? category : null;
    const key = known ? known.id : OTHER_KEY;
    let section = sections.get(key);
    if (!section) {
      const source = known ?? other;
      section = {
        key,
        title: source?.name ?? t('category.default.autre'),
        hue: categoryVisual(source ?? { templateKey: 'autre' }).hue,
        items: [],
      };
      sections.set(key, section);
    }
    section.items.push(item);
  }
  return [...sections.values()].sort(
    (a, b) =>
      (a.key === OTHER_KEY ? Number.POSITIVE_INFINITY : (order.get(a.key) ?? 0)) -
      (b.key === OTHER_KEY ? Number.POSITIVE_INFINITY : (order.get(b.key) ?? 0)),
  );
}

/** Plain-text list for `navigator.share` (§4.8.3): unchecked rows only, by section. */
export function shareText(dateText: string, sections: readonly GrocerySection[]): string {
  const lines = [t('groceries.share.header', { date: dateText })];
  for (const section of sections) {
    const rows = section.items.filter((i) => !i.checked);
    if (rows.length === 0) continue;
    lines.push('', section.title);
    for (const item of rows) {
      lines.push(t('groceries.share.line', { name: itemName(item), n: item.quantity ?? 1 }));
    }
  }
  return lines.join('\n');
}
