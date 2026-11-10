import { CloudAlert, CloudDownload, CloudOff, CloudUpload, type LucideIcon, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import type { ReactNode } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { Button } from './Button';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type SyncState = 'firstSync' | 'pending' | 'offline' | 'offlinePending' | 'error' | 'attention';

const SYNC_ICON: Record<SyncState, LucideIcon> = {
  firstSync: CloudDownload,
  pending: CloudUpload,
  offline: CloudOff,
  offlinePending: CloudOff,
  error: CloudAlert,
  attention: CloudAlert,
};

export interface SyncIndicatorProps {
  /** `null` when everything is synced: the indicator is hidden and takes no space. */
  state: SyncState | null;
  /** Visible text, e.g. «Hors ligne · 2 modifications en attente». */
  text: string;
  /** Spoken label, e.g. «Hors ligne, ouvrir les détails». */
  accessibleLabel: string;
  onPress: () => void;
  /** «Réessayer» after «Synchronisation interrompue». */
  retry?: { label: string; accessibleLabel: string; onPress: () => void } | undefined;
  /** Icon only (collapsed into the inline title). */
  compact?: boolean | undefined;
  /** Show a spinner instead of the icon (syncing for more than 1 s). */
  busy?: boolean | undefined;
}

/**
 * The single place sync and offline state is shown (03 §2.3): a subtitle line under the large title, neutral colours,
 * amber dot for «à vérifier». Appears and disappears with `smooth` (opacity + y 4 px); text changes cross-fade.
 */
export function SyncIndicator({ state, text, accessibleLabel, onPress, retry, compact, busy }: SyncIndicatorProps) {
  const transition = usePreset('smooth');
  const Icon = state ? SYNC_ICON[state] : null;
  return (
    <AnimatePresence initial={false}>
      {state && Icon ? (
        <m.div
          key="sync"
          role="status"
          className={cx('flex items-center', compact ? '' : 'h-5 gap-3 px-[calc(16px+var(--safe-left))]')}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={transition}
        >
          <button
            type="button"
            aria-label={accessibleLabel}
            onClick={onPress}
            className={cx(
              'relative flex min-w-0 items-center gap-1.5 text-label-secondary outline-none focus-visible:focus-ring active:opacity-60',
              'before:absolute before:-inset-y-3 before:inset-x-0',
              compact && 'size-11 justify-center',
            )}
          >
            {state === 'attention' ? (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning-fg" />
            ) : null}
            {busy ? (
              <Spinner size={16} />
            ) : (
              <Icon size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0" />
            )}
            {compact ? null : (
              <m.span
                key={text}
                aria-hidden="true"
                className="truncate type-subhead"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={transition}
              >
                {text}
              </m.span>
            )}
          </button>
          {retry && !compact ? (
            <button
              type="button"
              aria-label={retry.accessibleLabel}
              onClick={retry.onPress}
              className="relative shrink-0 type-subhead text-accent-fg outline-none before:absolute before:-inset-3 focus-visible:focus-ring active:opacity-60"
            >
              {retry.label}
            </button>
          ) : null}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

export interface StatusBannerProps {
  icon: LucideIcon;
  text: ReactNode;
  action?: { label: string; onPress: () => void } | undefined;
  /** Dismiss button label, e.g. «Masquer». */
  dismissLabel?: string | undefined;
  onDismiss?: (() => void) | undefined;
  tone?: 'neutral' | 'warning' | undefined;
  className?: string | undefined;
}

/** Persistent, dismissible notice at the top of a screen's content (04 §7): neutral surface, icon, one line, one action. */
export function StatusBanner({
  icon: Icon,
  text,
  action,
  dismissLabel,
  onDismiss,
  tone = 'neutral',
  className,
}: StatusBannerProps) {
  return (
    <div
      role="note"
      className={cx(
        'mx-4 flex min-h-[52px] items-center gap-3 rounded-md border border-edge py-2 pl-4',
        onDismiss ? 'pr-1' : 'pr-4',
        tone === 'warning' ? 'bg-warning-tint' : 'bg-surface',
        className,
      )}
    >
      <Icon
        size={20}
        strokeWidth={1.5}
        absoluteStrokeWidth
        aria-hidden="true"
        className={cx('shrink-0', tone === 'warning' ? 'text-warning-fg' : 'text-label-secondary')}
      />
      {/* Text and action share one line while they fit; a longer text takes the full width and the action wraps
          under it, aligned with the text, instead of squeezing the text into a narrow column. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3">
        <p className={cx('min-w-0 flex-auto type-callout text-label-primary', action && 'py-1')}>{text}</p>
        {action ? (
          <button
            type="button"
            onClick={action.onPress}
            className="-mx-1 min-h-11 shrink-0 px-1 text-left type-headline text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="flex size-11 shrink-0 items-center justify-center text-label-tertiary outline-none focus-visible:focus-ring active:opacity-60"
        >
          <X size={17} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string | undefined;
  action?: { label: string; onPress: () => void } | undefined;
  secondaryAction?: { label: string; onPress: () => void } | undefined;
  /** Enters with `smooth` once (opacity + y 8 px). */
  animateIn?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Empty screens and sections (03 §3.8): 64 px accent-tinted circle with a 28 px glyph, Title 3, one Subhead sentence,
 * at most one primary action (pill, min 200 px) and an optional text button.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  secondaryAction,
  animateIn = false,
  className,
}: EmptyStateProps) {
  const transition = usePreset('smooth');
  return (
    <m.div
      className={cx('mx-auto flex max-w-[300px] flex-col items-center text-center', className)}
      initial={animateIn ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-accent-tint text-accent-fg"
      >
        <Icon size={28} strokeWidth={1.75} absoluteStrokeWidth />
      </span>
      <h2 className="mt-4 type-title-3">{title}</h2>
      {body ? <p className="mt-1.5 type-subhead text-label-secondary">{body}</p> : null}
      {action ? (
        <Button pill onClick={action.onPress} className="mt-5 min-w-[200px] px-6">
          {action.label}
        </Button>
      ) : null}
      {secondaryAction ? (
        <button
          type="button"
          onClick={secondaryAction.onPress}
          className="mt-3 min-h-11 px-2 type-body text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
        >
          {secondaryAction.label}
        </button>
      ) : null}
    </m.div>
  );
}

export interface CardProps {
  title?: string | undefined;
  /** Trailing header link, e.g. «Tout voir». */
  headerAction?: { label: string; onPress: () => void } | undefined;
  children: ReactNode;
  /** Enters with `smooth` (opacity, y 8 px): only on its first appearance in a session. */
  animateIn?: boolean | undefined;
  className?: string | undefined;
}

/** Grouped surface on Accueil (04 §2): `surface`, radius 20, 16 px padding, no shadow. */
export function Card({ title, headerAction, children, animateIn = false, className }: CardProps) {
  const transition = usePreset('smooth');
  return (
    <m.section
      className={cx('mx-4 rounded-lg border border-edge bg-surface p-4', className)}
      initial={animateIn ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      {title || headerAction ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="min-w-0 truncate type-headline">{title}</h2> : <span />}
          {headerAction ? (
            <button
              type="button"
              onClick={headerAction.onPress}
              className="relative shrink-0 type-subhead text-accent-fg outline-none before:absolute before:-inset-3 focus-visible:focus-ring active:opacity-60"
            >
              {headerAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </m.section>
  );
}

export function SkeletonRow({ className }: { className?: string | undefined }) {
  return (
    <div aria-hidden="true" className={cx('flex min-h-[60px] items-center gap-3 px-4 py-3', className)}>
      <span className="size-9 shrink-0 rounded-sm bg-fill-tertiary" />
      <span className="flex flex-1 flex-col gap-2">
        <span className="h-3.5 w-2/3 rounded-xs bg-fill-tertiary" />
        <span className="h-3 w-1/3 rounded-xs bg-fill-quaternary" />
      </span>
    </div>
  );
}
