/**
 * Current cellier: a per-device preference (design 03 §1.1) shared by Accueil, Stock and the
 * scanner's default target. «Tous les celliers» (`'all'`) exists only with two or more celliers.
 * Stored in localStorage per household (deviation: the design names IndexedDB `meta`, whose keys
 * belong to src/shared/db).
 */
import { useSyncExternalStore } from 'react';
import type { HouseholdId, Pantry, PantryId } from '@/domain/types';

export type PantrySelection = PantryId | 'all';

const KEY = (householdId: string) => `cellier:pantry:${householdId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, PantrySelection | null>();

export function readPantryPreference(householdId: HouseholdId | null): PantrySelection | null {
  if (!householdId) return null;
  if (cache.has(householdId)) return cache.get(householdId) ?? null;
  let value: PantrySelection | null = null;
  try {
    value = (localStorage.getItem(KEY(householdId)) as PantrySelection | null) ?? null;
  } catch {
    value = null;
  }
  cache.set(householdId, value);
  return value;
}

export function writePantryPreference(householdId: HouseholdId, selection: PantrySelection): void {
  cache.set(householdId, selection);
  try {
    localStorage.setItem(KEY(householdId), selection);
  } catch {
    // memory only
  }
  for (const l of [...listeners]) l();
}

export function subscribePantryPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePantryPreference(householdId: HouseholdId | null): PantrySelection | null {
  return useSyncExternalStore(
    subscribePantryPreference,
    () => readPantryPreference(householdId),
    () => null,
  );
}

/** Resolves the stored preference against the live celliers (pure). */
export function resolvePantrySelection(
  preference: PantrySelection | null,
  pantries: readonly Pantry[],
): { selection: PantrySelection | null; pantry: Pantry | null } {
  if (pantries.length === 0) return { selection: null, pantry: null };
  if (preference === 'all' && pantries.length >= 2) return { selection: 'all', pantry: null };
  const found = preference ? pantries.find((p) => p.id === preference) : undefined;
  const pantry = found ?? (pantries[0] as Pantry);
  return { selection: pantry.id, pantry };
}
