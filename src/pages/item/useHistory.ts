import { useMemo } from 'react';
import type { FieldOverwrite, ProductFields, ProductId } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { useMembers } from '@/entities/member';
import { useProductMovements } from '@/entities/movement';
import { useRowOverwrites } from '@/entities/overwrite';
import { usePantries } from '@/entities/pantry';
import { formatPriceCents, formatRelativeTime, t } from '@/shared/i18n';
import { type CellierSnapshot, hlcDeviceId, useStore, useSyncEngine } from '@/shared/sync';
import type { PlainMessageKey } from '@/widgets/item/productText';
import { tryMutate } from '@/widgets/item/stockActions';
import { buildHistory, type HistoryContext, type HistoryEntry } from './model/history';

/** Product fields whose overwrites are shown, with their label. */
const FIELD_LABELS: Partial<Record<keyof ProductFields, PlainMessageKey>> = {
  name: 'field.name',
  brand: 'field.brand',
  categoryId: 'field.category',
  netQuantity: 'field.size',
  packCount: 'field.packCount',
  priceCents: 'field.unitPrice',
  minQuantity: 'item.alert.threshold',
  usualQuantity: 'item.alert.usual',
};

const selectUserId = (s: CellierSnapshot): string | null => s.userId ?? null;

export interface HistoryMeta {
  /** «Vous», or the member's name. */
  memberName: (userId: string | null) => string;
  pantryName: (pantryId: string) => string;
}

/** History entries of one product plus the names its rows need. */
export function useProductHistory(productId: string): { entries: HistoryEntry[]; meta: HistoryMeta } {
  const movements = useProductMovements(productId);
  const overwrites = useRowOverwrites(productId);
  const deviceId = useSyncEngine()?.deviceId ?? null;
  const members = useMembers();
  const pantries = usePantries();
  const categories = useCategories();
  const me = useStore(selectUserId);

  const meta = useMemo<HistoryMeta>(() => {
    const memberNames = new Map(members.map((m) => [m.userId as string, m.displayName]));
    const pantryNames = new Map(pantries.map((p) => [p.id as string, p.name]));
    return {
      memberName: (userId) =>
        userId === null || userId === me ? t('common.you') : (memberNames.get(userId) ?? t('history.formerMember')),
      pantryName: (pantryId) => pantryNames.get(pantryId) ?? t('history.deletedPantry'),
    };
  }, [members, pantries, me]);

  const entries = useMemo(() => {
    const categoryNames = new Map(categories.map((c) => [c.id as string, c.name]));
    const mine = deviceId ? overwrites.filter((o) => hlcDeviceId(o.oldHlc) === deviceId) : [];
    const ctx: HistoryContext = {
      ...meta,
      fieldLabel: (field) => {
        const key = FIELD_LABELS[field as keyof ProductFields];
        return key ? t(key) : null;
      },
      formatValue: (field, value) => formatFieldValue(field, value, categoryNames),
    };
    return buildHistory(movements, mine, ctx);
  }, [movements, overwrites, deviceId, categories, meta]);

  return { entries, meta };
}

function formatFieldValue(field: string, value: unknown, categoryNames: ReadonlyMap<string, string>): string {
  if (value === null || value === undefined || value === '') return t('common.none');
  if (field === 'categoryId') return categoryNames.get(String(value)) ?? t('stock.group.noCategory');
  if (field === 'priceCents' && typeof value === 'number') return formatPriceCents(value);
  return typeof value === 'number' ? new Intl.NumberFormat('fr-FR').format(value) : String(value);
}

/** «Rétablir» on a «Modification remplacée» row: writes the old value again as a new edit. */
export function restoreOverwrite(overwrite: FieldOverwrite): void {
  tryMutate('product.update', {
    productId: overwrite.rowId as ProductId,
    fields: { [overwrite.field]: overwrite.oldValue } as ProductFields,
  });
}

/** «{relative time}» of an entry. */
export function entryTime(entry: HistoryEntry, now: Date): string {
  return entry.pending ? formatRelativeTime(now, now) : formatRelativeTime(new Date(entry.at), now);
}

/** «{member} · {pantry} · {time}» (or without the pantry for moves and edits). */
export function entryMeta(entry: HistoryEntry, meta: HistoryMeta, now: Date): string {
  const member = meta.memberName(entry.actorId);
  const time = entryTime(entry, now);
  return entry.pantryId
    ? t('history.meta', { member, pantry: meta.pantryName(entry.pantryId), time })
    : t('activity.row.meta', { member, time });
}
