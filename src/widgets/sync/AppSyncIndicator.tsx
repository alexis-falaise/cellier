import { useEffect, useState } from 'react';
import { openSheet } from '@/app/navigation';
import { syncNow, useAppSession } from '@/app/session';
import { useSyncSummary } from '@/entities/sync';
import { useOnline } from '@/features/auth';
import { t } from '@/shared/i18n';
import { SyncIndicator } from '@/shared/ui';
import { syncView } from './syncView';

const PENDING_DELAY_MS = 5000;

/** True once `active` has stayed true for `delayMs`. */
function useDelayedTrue(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

/** The sync summary as the indicator shows it (also used by SyncSheet). */
export function useSyncView() {
  const summary = useSyncSummary();
  const online = useOnline();
  const { household } = useAppSession();
  const pendingVisible = useDelayedTrue(summary.pendingCount > 0 && online, PENDING_DELAY_MS);
  return {
    summary,
    online,
    view: syncView({
      status: summary.status,
      pendingCount: summary.pendingCount,
      attentionCount: summary.attention.length,
      firstSync: summary.firstSync,
      hasHousehold: household.id !== null,
      online,
      pendingVisible,
    }),
  };
}

export interface AppSyncIndicatorProps {
  /** Icon only, beside the collapsed inline title. */
  compact?: boolean | undefined;
}

/**
 * The SyncIndicator wired to the sync engine (design 03 §2.3). Put it in `LargeTitleHeader`'s
 * `subtitle` on every tab root and pushed screen; it takes no space when everything is synced.
 */
export function AppSyncIndicator({ compact }: AppSyncIndicatorProps) {
  const { view, summary } = useSyncView();
  return (
    <SyncIndicator
      state={view.state}
      text={view.text}
      accessibleLabel={view.label}
      onPress={() => openSheet({ sheet: 'sync' })}
      busy={summary.status.kind === 'syncing' && view.state === 'firstSync'}
      compact={compact}
      retry={
        view.retry
          ? { label: t('common.retry'), accessibleLabel: t('a11y.sync.retry'), onPress: () => void syncNow() }
          : undefined
      }
    />
  );
}
