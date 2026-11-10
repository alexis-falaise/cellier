import { CircleAlert, type LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { closeConfirm, closeSheet, popSheetPage } from '@/app/navigation';
import { showToast } from '@/app/toasts';
import { t } from '@/shared/i18n';
import { BackButton, cx, SheetHeader, useScreenScrollRef } from '@/shared/ui';
import type { SettingsFailure } from '../api';
import { initials } from '../model/account';
import { PAGE_TITLE, type PlainMessageKey, parentPage, type SettingsPageName } from '../model/pages';

export interface PageLayoutProps {
  page: SettingsPageName;
  /** Header title; defaults to the page's title. */
  title?: string | undefined;
  /** Replaces the back button (e.g. «Annuler» on a creation page). */
  leading?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  children: ReactNode;
}

/**
 * One page of the Réglages sheet: a sticky `SheetHeader` (back chevron + previous title inside a
 * push, 03 §3.6) over inset grouped sections. The page's scroll view is marked as the sheet's
 * scroller so a downward drag hands off to the sheet only at the top (02 §3.2).
 */
export function PageLayout({ page, title, leading, trailing, children }: PageLayoutProps) {
  const scrollRef = useScreenScrollRef();
  useEffect(() => {
    scrollRef?.current?.setAttribute('data-sheet-scroll', '');
  }, [scrollRef]);
  const previous = parentPage(page);
  const back =
    page === 'root' ? undefined : (
      <BackButton
        previousTitle={t(PAGE_TITLE[previous])}
        fallbackLabel={t('common.back')}
        accessibleLabel={t('common.back')}
        onPress={popSheetPage}
      />
    );
  return (
    <div className="flex min-h-full flex-col bg-bg-elevated">
      <div className="sticky top-0 z-10 bg-bg-elevated">
        <SheetHeader title={title ?? t(PAGE_TITLE[page])} leading={leading ?? back} trailing={trailing} />
      </div>
      <div className="flex flex-col gap-8 pt-2 pb-[calc(var(--safe-bottom)+24px)]">{children}</div>
    </div>
  );
}

/** 28 px icon tile of a Réglages root row (03 §4.10). */
export function RowIcon({ icon: Icon, tone = 'neutral' }: { icon: LucideIcon; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex size-7 items-center justify-center rounded-[6px]',
        tone === 'accent' ? 'bg-accent text-on-accent' : 'bg-fill-secondary text-label-secondary',
      )}
    >
      <Icon size={17} strokeWidth={1.5} absoluteStrokeWidth />
    </span>
  );
}

/** Google photo or initials, any size (MemberRow 40 px, account and member pages 80 px). */
export function Avatar({ src, name, size }: { src: string | null | undefined; name: string | null; size: number }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-primary font-semibold text-label-secondary',
        size >= 56 ? 'type-title-2' : 'type-footnote',
      )}
      style={{ width: size, height: size }}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

/** Large centred identity block of the account and member pages. */
export function IdentityBlock({
  avatarUrl,
  name,
  lines,
}: {
  avatarUrl: string | null | undefined;
  name: string;
  lines: ReadonlyArray<string | null>;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 text-center">
      <Avatar src={avatarUrl} name={name} size={80} />
      <h3 className="mt-3 type-title-2 text-balance">{name}</h3>
      {lines.map((line) =>
        line ? (
          <p key={line} className="type-subhead text-label-secondary">
            {line}
          </p>
        ) : null,
      )}
    </div>
  );
}

const FAILURE_KEYS: Partial<Record<SettingsFailure, PlainMessageKey>> = {
  offline: 'settings.offline',
  not_owner: 'settings.error.notOwner',
  owner_must_transfer: 'household.leave.ownerBlocked',
};

/** A failed online action, as a toast (no decision is needed: the user can retry). */
export function showFailure(reason: SettingsFailure, fallback: PlainMessageKey = 'settings.error.generic'): void {
  showToast({ message: t(FAILURE_KEYS[reason] ?? fallback), icon: CircleAlert, key: 'settings-error' });
}

/** Runs a history step (back or replace) and resolves once it has landed. */
function stepAndWait(step: () => void): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', finish);
      resolve();
    };
    window.addEventListener('popstate', finish);
    step();
    window.setTimeout(finish, 400);
  });
}

/** Closes the open confirmation and resolves once the history step has landed. */
export function closeConfirmAndWait(): Promise<void> {
  return stepAndWait(closeConfirm);
}

/** Closes the whole sheet and resolves once the history step has landed (before navigating elsewhere). */
export function closeSheetAndWait(): Promise<void> {
  return stepAndWait(closeSheet);
}
