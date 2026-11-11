/**
 * Background classification (05-catalogue.md §5.8): products without a kind are sent, 25 at a
 * time, to the `classify-product` Edge Function; each answer becomes one `product.update`
 * (optimistic and queued like any edit). Runs only while online after the first sync; a product
 * that fails is retried at the next app start, never in a loop.
 */
import { useEffect, useRef } from 'react';
import type { Category, Product } from '@/domain/types';
import { selectCategories } from '@/entities/category';
import { createSelector, type Selector } from '@/entities/lib/selector';
import { useOnline } from '@/features/auth';
import { supabase } from '@/shared/api/supabase';
import { type CellierSnapshot, mutate, useStore } from '@/shared/sync';
import {
  CLASSIFY_BATCH,
  type ClassifyAnswer,
  fieldsFromAnswer,
  householdExamples,
  householdKinds,
  pendingClassification,
  requestItem,
} from './model/classify';

const selectProducts: Selector<readonly Product[]> = createSelector(
  (s: CellierSnapshot) => [s.rows.product] as const,
  (rows) => [...rows.values()],
);

/** Ids sent this session (answered or failed); cleared on reload. */
const tried = new Set<string>();
const RETRY_AFTER_ERROR_MS = 60_000;

async function classifyBatch(products: readonly Product[], categories: readonly Category[]): Promise<void> {
  const batch = pendingClassification(products, tried).slice(0, CLASSIFY_BATCH);
  if (batch.length === 0) return;
  for (const p of batch) tried.add(p.id);
  const { data, error } = await supabase.functions.invoke('classify-product', {
    body: {
      items: batch.map((p) => requestItem(p, categories)),
      kinds: householdKinds(products),
      examples: householdExamples(products, categories),
    },
  });
  if (error) throw error;
  const answers = ((data as { results?: ClassifyAnswer[] } | null)?.results ?? []) as ClassifyAnswer[];
  // Each answer sees the products already updated by the previous ones (same-kind overrides).
  let current = products;
  for (const answer of answers) {
    const product = current.find((p) => p.id === answer.id);
    if (!product) continue;
    const fields = fieldsFromAnswer(product, answer, current, categories);
    if (Object.keys(fields).length === 0) continue;
    try {
      mutate('product.update', { productId: product.id, fields });
      current = current.map((p) => (p.id === product.id ? ({ ...p, ...fields } as Product) : p));
    } catch (e) {
      console.error('[classify] update refused', e);
    }
  }
}

/** Mounted once by the tab shell. `enabled`: the household is synced. */
export function useAutoClassify(enabled: boolean): void {
  const products = useStore(selectProducts);
  const categories = useStore(selectCategories);
  const online = useOnline();
  const running = useRef(false);
  const pausedUntil = useRef(0);

  useEffect(() => {
    if (!enabled || !online || running.current || Date.now() < pausedUntil.current) return;
    if (categories.length === 0 || pendingClassification(products, tried).length === 0) return;
    running.current = true;
    classifyBatch(products, categories)
      .catch((e) => {
        console.warn('[classify] unavailable', e);
        pausedUntil.current = Date.now() + RETRY_AFTER_ERROR_MS;
      })
      .finally(() => {
        running.current = false;
      });
  }, [enabled, online, products, categories]);
}
