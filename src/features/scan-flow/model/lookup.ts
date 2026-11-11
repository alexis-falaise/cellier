/** The app's catalogue lookup chain (05 §8.1), shared by the scanner and the receipt review. */
import { type CatalogueClient, type CatalogueLookup, createCatalogueLookup } from '@/features/catalogue';
import { supabase } from '@/shared/api/supabase';
import { getSyncStore } from '@/shared/sync';
import { createLookupLocal, deviceCatalogue } from './local';

let lookupSingleton: CatalogueLookup | null = null;

export function catalogueLookup(): CatalogueLookup {
  lookupSingleton ??= createCatalogueLookup({
    client: supabase as unknown as CatalogueClient,
    lookupLocal: createLookupLocal(() => getSyncStore().getSnapshot()),
    remember: (product) => deviceCatalogue.remember(product),
  });
  return lookupSingleton;
}
