import { useCallback, useMemo } from 'react';
import type { Pantry } from '@/domain/types';
import { useMembers } from '@/entities/member';
import { useActivityEntries, useMovements } from '@/entities/movement';
import { selectProductViewMap } from '@/entities/product';
import { t } from '@/shared/i18n';
import { type CellierSnapshot, useStore } from '@/shared/sync';
import { buildFeed, type FeedRow } from './model/feed';

const selectPantryRows = (s: CellierSnapshot): ReadonlyMap<string, Pantry> => s.rows.pantry;
const selectUserId = (s: CellierSnapshot) => s.userId;

export interface ActivityFeed {
  rows: readonly FeedRow[];
  /** «Vous», the member's name, or «Ancien membre». */
  memberLabel: (actorId: string | null) => string;
  /** Ids of local notes (clamped, adjusted…) not yet seen, and the movements they are about. */
  unreadNoteIds: readonly string[];
  unreadMovementIds: ReadonlySet<string>;
}

/** The household ledger as Activité rows (deleted products and celliers keep their names). */
export function useActivityFeed(): ActivityFeed {
  const movements = useMovements();
  const products = useStore(selectProductViewMap);
  const pantries = useStore(selectPantryRows);
  const members = useMembers();
  const me = useStore(selectUserId);
  const notes = useActivityEntries();

  const rows = useMemo(
    () =>
      buildFeed(movements, {
        productName: (id) => products.get(id)?.product.name ?? '',
        pantryName: (id) => pantries.get(id)?.name ?? '',
      }),
    [movements, products, pantries],
  );

  const names = useMemo(() => new Map(members.map((mb) => [mb.userId as string, mb.displayName])), [members]);
  const memberLabel = useCallback(
    (actorId: string | null) => {
      if (actorId !== null && actorId === me) return t('common.you');
      return (actorId !== null ? names.get(actorId) : undefined) ?? t('activity.row.formerMember');
    },
    [me, names],
  );

  const unread = useMemo(() => {
    const list = notes.filter((n) => !n.read);
    return { ids: list.map((n) => n.id), movements: new Set(list.map((n) => n.mutationId as string)) };
  }, [notes]);

  return { rows, memberLabel, unreadNoteIds: unread.ids, unreadMovementIds: unread.movements };
}
