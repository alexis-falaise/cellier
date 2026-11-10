import type { Pantry } from '@/domain/types';
import { useStore } from '@/shared/sync';
import { type PantryStockItem, selectDeletedPantries, selectPantries, selectPantry, selectPantryStock } from './model';

export * from './model';

export function usePantries(): readonly Pantry[] {
  return useStore(selectPantries);
}

export function useDeletedPantries(): readonly Pantry[] {
  return useStore(selectDeletedPantries);
}

export function usePantry(pantryId: string): Pantry | undefined {
  return useStore(selectPantry(pantryId));
}

export function usePantryStock(pantryId: string): readonly PantryStockItem[] {
  return useStore(selectPantryStock(pantryId));
}
