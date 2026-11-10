/**
 * Device-side pieces of the lookup chain and the tray draft:
 * - `lookupHousehold`: the household product with a GTIN in the sync store (tombstones included), synchronous so
 *   a known product lands in the tray in the same task as the detection (02 §4.3).
 * - `deviceCatalogue`: rows fetched online, kept on this device so a re-scan needs no network (`remember`).
 * - `draftStore`: the tray written on every change so a killed app gets its scan back (03 §4.4.9).
 * Storage is localStorage (deviation: the design names IndexedDB, whose schema belongs to src/shared/db).
 */
import type { Gtin, ProductId } from '@/domain/types';
import type { CatalogProduct, LocalLookupResult } from '@/features/catalogue';
import type { CellierSnapshot } from '@/shared/sync';
import { isTrayRow, type ScanMode, type TrayRow } from './tray';

export function lookupHousehold(
  snapshot: CellierSnapshot,
  gtin: Gtin,
): { productId: ProductId; deleted: boolean } | null {
  let tombstone: ProductId | null = null;
  for (const p of snapshot.rows.product.values()) {
    if (p.gtin !== gtin) continue;
    if (p.deletedAt === null) return { productId: p.id, deleted: false };
    tombstone ??= p.id;
  }
  return tombstone ? { productId: tombstone, deleted: true } : null;
}

function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: best effort.
  }
}

const CACHE_KEY = 'cellier.catalogue.device';
const CACHE_MAX = 300;

/** A small LRU of catalogue rows on this device (most recent last). */
export function createDeviceCatalogue(key = CACHE_KEY, max = CACHE_MAX) {
  let entries: Map<string, CatalogProduct> | null = null;
  const load = () => {
    if (entries) return entries;
    entries = new Map();
    const stored = readJson(key);
    if (Array.isArray(stored)) {
      for (const p of stored as CatalogProduct[]) {
        if (p && typeof p.gtin === 'string' && typeof p.name === 'string') entries.set(p.gtin, p);
      }
    }
    return entries;
  };
  return {
    get(gtin: Gtin): CatalogProduct | null {
      return load().get(gtin) ?? null;
    },
    remember(product: CatalogProduct): void {
      const map = load();
      map.delete(product.gtin);
      map.set(product.gtin, product);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
      writeJson(key, [...map.values()]);
    },
  };
}

export const deviceCatalogue = createDeviceCatalogue();

/** `lookupLocal` for `createCatalogueLookup`: household store first, then the device cache. */
export function createLookupLocal(getSnapshot: () => CellierSnapshot) {
  return (gtin: Gtin): LocalLookupResult | null => {
    const hit = lookupHousehold(getSnapshot(), gtin);
    if (hit) return { source: 'household', productId: hit.productId, deleted: hit.deleted };
    const cached = deviceCatalogue.get(gtin);
    return cached ? { source: 'device_cache', product: cached } : null;
  };
}

// ---------------------------------------------------------------------------------------------
// Tray draft
// ---------------------------------------------------------------------------------------------

export interface TrayDraft {
  rows: TrayRow[];
  mode: ScanMode;
  savedAt: number;
}

const DRAFT_KEY = (householdId: string) => `cellier.scan.draft:${householdId}`;
/** Older drafts are not offered back. */
const DRAFT_MAX_AGE_MS = 7 * 86_400_000;

export const draftStore = {
  read(householdId: string, now = Date.now()): TrayDraft | null {
    const value = readJson(DRAFT_KEY(householdId)) as Partial<TrayDraft> | null;
    if (!value || !Array.isArray(value.rows) || typeof value.savedAt !== 'number') return null;
    if (now - value.savedAt > DRAFT_MAX_AGE_MS) return null;
    const rows = value.rows.filter(isTrayRow);
    if (rows.length === 0) return null;
    return { rows, mode: value.mode === 'withdraw' ? 'withdraw' : 'add', savedAt: value.savedAt };
  },
  write(householdId: string, rows: readonly TrayRow[], mode: ScanMode, now = Date.now()): void {
    writeJson(DRAFT_KEY(householdId), rows.length > 0 ? { rows, mode, savedAt: now } : null);
  },
  clear(householdId: string): void {
    writeJson(DRAFT_KEY(householdId), null);
  },
};
