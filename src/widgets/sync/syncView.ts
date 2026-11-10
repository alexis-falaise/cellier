/**
 * SyncIndicator state and copy (design 03 §2.3), as a pure function of the sync summary.
 * Precedence: first sync > needs attention > error > offline with pending > offline > pending.
 * An auth error is not shown here: the session-expired banner covers it (§2.2).
 */
import type { SyncStatus } from '@/domain/types';
import { t } from '@/shared/i18n';
import type { SyncState } from '@/shared/ui';

export interface SyncViewInput {
  status: SyncStatus;
  pendingCount: number;
  attentionCount: number;
  firstSync: boolean;
  /** A household is open (no indicator before onboarding). */
  hasHousehold: boolean;
  online: boolean;
  /** The outbox has been non-empty for 5 s while online. */
  pendingVisible: boolean;
}

export interface SyncView {
  state: SyncState | null;
  text: string;
  label: string;
  retry: boolean;
}

const HIDDEN: SyncView = { state: null, text: '', label: '', retry: false };

export function syncView(input: SyncViewInput): SyncView {
  if (!input.hasHousehold) return HIDDEN;
  const open = t('a11y.sync.openDetails');
  const offline = !input.online || input.status.kind === 'offline';
  if (input.firstSync) {
    return {
      state: 'firstSync',
      text: t('sync.indicator.firstSync'),
      label: t('a11y.sync.firstSync'),
      retry: false,
    };
  }
  if (input.attentionCount > 0) {
    const n = input.attentionCount;
    return {
      state: 'attention',
      text: t('sync.indicator.attention', { n }),
      label: t('a11y.sync.attention', { n }),
      retry: false,
    };
  }
  if (input.status.kind === 'error' && input.status.reason !== 'auth' && !offline) {
    const text = t('sync.indicator.error');
    return { state: 'error', text, label: `${text}${open}`, retry: true };
  }
  if (offline && input.pendingCount > 0) {
    const text = t('sync.indicator.offlinePending', { n: input.pendingCount });
    return { state: 'offlinePending', text, label: `${text}${open}`, retry: false };
  }
  if (offline) {
    const text = t('sync.indicator.offline');
    return { state: 'offline', text, label: `${text}${open}`, retry: false };
  }
  if (input.pendingCount > 0 && input.pendingVisible) {
    const text = t('sync.indicator.pending', { n: input.pendingCount });
    return { state: 'pending', text, label: `${text}${open}`, retry: false };
  }
  return HIDDEN;
}
