import { Check, SquarePlus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { openSheet } from '@/app/navigation';
import { detectIOS } from '@/features/notifications';
import { t } from '@/shared/i18n';
import {
  type CategoryVisual,
  cx,
  ForecastBadge,
  ItemRow,
  isStandalone,
  ListRow,
  ListSection,
  SkeletonRow,
  SwipeActions,
} from '@/shared/ui';
import { type LowRowModel, lowBadgeText } from './model/runningLow';

/** Accueil section header (03 §4.2.1): Headline, x = 32, optional trailing text button. */
export function HomeSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: { label: string; onPress: () => void } | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('mt-6', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-8">
        <h2 id={id} className="min-w-0 truncate type-headline text-label-primary">
          {title}
        </h2>
        {action ? (
          <button
            type="button"
            onClick={action.onPress}
            className="relative shrink-0 type-subhead text-accent-fg outline-none before:absolute before:-inset-3 focus-visible:focus-ring active:opacity-60"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export interface LowListRow extends LowRowModel {
  secondary: string;
  visual: CategoryVisual;
}

/** «Bientôt épuisé» rows (03 §4.2.3): `ItemRow` low variant with a ForecastBadge, at most 5 then «Voir les n». */
export function LowList({
  rows,
  total,
  onOpen,
  onSeeAll,
}: {
  rows: readonly LowListRow[];
  total: number;
  onOpen: (productId: string) => void;
  onSeeAll: () => void;
}) {
  return (
    <ListSection label={t('home.low.title')}>
      {rows.map((row) => {
        const badge = lowBadgeText(row.badge);
        return (
          <ItemRow
            key={row.productId}
            variant="low"
            name={row.name}
            secondary={row.secondary}
            visual={row.visual}
            quantity={row.totalQuantity}
            low
            trailing={<ForecastBadge label={badge.label} accessibleLabel={badge.accessibleLabel} />}
            accessibleLabel={`${t('a11y.item.row', {
              name: row.name,
              details: badge.accessibleLabel,
              quantity: row.totalQuantity,
            })}${t('a11y.item.lowSuffix')}`}
            onPress={() => onOpen(row.productId)}
          />
        );
      })}
      {total > rows.length ? (
        <ListRow
          variant="button"
          title={<span className="block text-center">{t('home.low.seeAll', { n: total })}</span>}
          onPress={onSeeAll}
        />
      ) : null}
    </ListSection>
  );
}

/** «Rien ne manque» (03 §4.2.3): one 60 px row with a check tile. */
export function NothingLowRow({ next }: { next: { name: string; days: number } | null }) {
  return (
    <ListSection label={t('home.low.title')}>
      {/* biome-ignore lint/a11y/useSemanticElements: rows of an inset list, not direct li elements */}
      <div role="listitem" className="flex min-h-[60px] items-center gap-3 px-4 py-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-fill-tertiary text-label-secondary"
        >
          <Check size={20} strokeWidth={1.5} absoluteStrokeWidth />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body text-label-primary">{t('home.low.none.title')}</span>
          <span className="type-subhead text-label-secondary">
            {next ? t('home.low.none.next', { product: next.name, d: next.days }) : t('home.low.none.body')}
          </span>
        </span>
      </div>
    </ListSection>
  );
}

export function SkeletonList({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className="mx-4 overflow-hidden rounded-md border border-edge bg-surface">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

const INSTALL_HIDDEN_KEY = 'cellier.home.installHiddenUntil';
const THIRTY_DAYS_MS = 30 * 86_400_000;

function readHiddenUntil(): number {
  try {
    return Number(globalThis.localStorage?.getItem(INSTALL_HIDDEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function shouldOfferInstall(): boolean {
  if (typeof navigator === 'undefined' || isStandalone()) return false;
  if (!detectIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) return false;
  return readHiddenUntil() < Date.now();
}

/** Safari-only row (03 §4.2.1 item 7): opens the install guide; swipe «Masquer» hides it for 30 days. */
export function InstallRow() {
  const [visible, setVisible] = useState(shouldOfferInstall);
  if (!visible) return null;
  const hide = () => {
    try {
      globalThis.localStorage?.setItem(INSTALL_HIDDEN_KEY, String(Date.now() + THIRTY_DAYS_MS));
    } catch {
      // Storage blocked: hidden for this session only.
    }
    setVisible(false);
  };
  return (
    <ListSection label={t('home.installRow')} className="mt-6">
      <SwipeActions trailing={[{ label: t('common.hide'), tone: 'neutral', onAction: hide, removesRow: true }]}>
        <ListRow
          variant="button"
          icon={SquarePlus}
          title={t('home.installRow')}
          onPress={() => openSheet({ sheet: 'install' })}
        />
      </SwipeActions>
    </ListSection>
  );
}
