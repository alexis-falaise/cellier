/**
 * Sync indicator and sheet (design: sync.indicator.*, sync.sheet.*): status, pending count,
 * offline, «À vérifier» items, quarantine and clock-skew warning.
 */
import type { IsoDateTime, SyncStatus } from '@/domain/types';
import { type HouseholdNotice, type OutboxEntry, useStore } from '@/shared/sync';
import { createSelector, type Selector } from '../lib/selector';

/** 02 §9 case 20: warn in Réglages when the device clock is more than 5 minutes off. */
export const CLOCK_SKEW_WARNING_MS = 5 * 60_000;

export interface SyncSummary {
  status: SyncStatus;
  /** Mutations not yet acknowledged (pending or in flight). */
  pendingCount: number;
  offline: boolean;
  /** Entries needing a decision: gone / invalid / dependency_failed (not quarantined). */
  attention: readonly OutboxEntry[];
  /** Entries of a household this user no longer belongs to. */
  quarantined: readonly OutboxEntry[];
  notice: HouseholdNotice;
  lastSyncedAt: IsoDateTime | null;
  clockSkewWarning: boolean;
  /** True until the first snapshot of the household has been applied. */
  firstSync: boolean;
}

/** Overlay entries still to be sent or acknowledged, in seq order. */
export const selectPendingEntries: Selector<readonly OutboxEntry[]> = createSelector(
  (s) => [s.overlay] as const,
  (overlay) => overlay.filter((e) => e.state === 'pending' || e.state === 'inflight'),
);

export const selectAttentionEntries: Selector<readonly OutboxEntry[]> = createSelector(
  (s) => [s.attention] as const,
  (list) => list.filter((e) => e.state === 'attention'),
);

export const selectQuarantinedEntries: Selector<readonly OutboxEntry[]> = createSelector(
  (s) => [s.attention] as const,
  (list) => list.filter((e) => e.state === 'quarantined'),
);

/** Attention entries grouped under their failed parent (02 §9 case 19). */
export const selectAttentionGroups: Selector<ReadonlyArray<{ entry: OutboxEntry; dependents: OutboxEntry[] }>> =
  createSelector(
    (s) => [selectAttentionEntries(s)] as const,
    (list) => {
      const byId = new Map(list.map((e) => [e.id as string, e]));
      const rootOf = (e: OutboxEntry, seen = new Set<string>()): string | null => {
        for (const p of e.dependsOn) {
          const parent = byId.get(p);
          if (!parent || seen.has(p)) continue;
          if (parent.attentionReason !== 'dependency_failed') return p;
          seen.add(p);
          const root = rootOf(parent, seen);
          if (root) return root;
        }
        return null;
      };
      const groups = list
        .filter((e) => e.attentionReason !== 'dependency_failed')
        .map((entry) => ({ entry, dependents: [] as OutboxEntry[] }));
      const byRoot = new Map(groups.map((g) => [g.entry.id as string, g]));
      for (const e of list) {
        if (e.attentionReason !== 'dependency_failed') continue;
        const root = rootOf(e);
        const group = root ? byRoot.get(root) : undefined;
        if (group) group.dependents.push(e);
        else groups.push({ entry: e, dependents: [] });
      }
      return groups;
    },
  );

let lastSummary: SyncSummary | undefined;

export const selectSyncSummary: Selector<SyncSummary> = (s) => {
  const status = s.status;
  const pending = selectPendingEntries(s);
  const next: SyncSummary = {
    status,
    pendingCount: pending.length,
    offline: status.kind === 'offline',
    attention: selectAttentionEntries(s),
    quarantined: selectQuarantinedEntries(s),
    notice: s.notice,
    lastSyncedAt: status.kind === 'idle' ? status.lastSyncedAt : (lastSummary?.lastSyncedAt ?? null),
    clockSkewWarning: Math.abs(s.clockSkewMs) > CLOCK_SKEW_WARNING_MS,
    firstSync: s.cursor === 0,
  };
  if (
    lastSummary &&
    (Object.keys(next) as (keyof SyncSummary)[]).every((k) => Object.is(next[k], (lastSummary as SyncSummary)[k]))
  ) {
    return lastSummary;
  }
  lastSummary = next;
  return next;
};

export function useSyncSummary(): SyncSummary {
  return useStore(selectSyncSummary);
}

export function usePendingCount(): number {
  return useStore((s) => selectPendingEntries(s).length);
}

export function useAttentionGroups() {
  return useStore(selectAttentionGroups);
}
