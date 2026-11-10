import { describe, expect, it } from 'vitest';
import type { Pantry, PantryId } from '@/domain/types';
import { resolvePantrySelection } from './pantry';

const pantry = (id: string) => ({ id: id as PantryId, name: id }) as unknown as Pantry;

describe('resolvePantrySelection', () => {
  const two = [pantry('cave'), pantry('cuisine')];

  it('waits for the first pull', () => {
    expect(resolvePantrySelection('all', [])).toEqual({ selection: null, pantry: null });
  });

  it('keeps a stored choice that still exists', () => {
    expect(resolvePantrySelection('cuisine' as PantryId, two).selection).toBe('cuisine');
    expect(resolvePantrySelection('all', two)).toEqual({ selection: 'all', pantry: null });
  });

  it('falls back to the first cellier', () => {
    expect(resolvePantrySelection('gone' as PantryId, two).selection).toBe('cave');
    expect(resolvePantrySelection(null, two).selection).toBe('cave');
    expect(resolvePantrySelection('all', [pantry('cave')]).selection).toBe('cave');
  });
});
