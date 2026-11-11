/**
 * The seasonal calendar the app reads: ADEME's fruits and vegetables (calendar.data.ts, generated)
 * plus a few foods with a regulated season, and how list names map to them.
 */
import { ADEME_CALENDAR } from './calendar.data';
import type { SeasonalEntry } from './types';

/**
 * Foods outside ADEME's calendar whose season is set by regulation or by the trade:
 * - Coquille Saint-Jacques: French fishing season, 1 October to 15 May.
 * - Huître: traditionally the months with an «r», September to April.
 * - Mont d'Or: AOP, sold from 10 September to 10 May.
 */
const SUPPLEMENT: readonly SeasonalEntry[] = [
  { slug: 'saintjacques', name: 'Saint-Jacques', group: 'mer', months: [1, 2, 3, 4, 5, 10, 11, 12], kgCo2e: null },
  { slug: 'huitre', name: 'Huîtres', group: 'mer', months: [1, 2, 3, 4, 9, 10, 11, 12], kgCo2e: null },
  { slug: 'montdor', name: 'Mont d’Or', group: 'fromage', months: [1, 2, 3, 4, 5, 9, 10, 11, 12], kgCo2e: null },
];

/** Display names where ADEME's carry a note («Haricot vert (cru)»). */
const DISPLAY_NAMES: Record<string, string> = {
  champignonmorille: 'Morille',
  haricotvert: 'Haricot vert',
  mangue: 'Mangue (avion)',
  manguebateau: 'Mangue',
};

export const SEASONAL_FOODS: readonly SeasonalEntry[] = [...ADEME_CALENDAR, ...SUPPLEMENT].map((e) => ({
  ...e,
  name: DISPLAY_NAMES[e.slug] ?? e.name,
}));

export const FOODS_BY_SLUG: ReadonlyMap<string, SeasonalEntry> = new Map(SEASONAL_FOODS.map((e) => [e.slug, e]));

/** Other names a list row or a product kind may use; a food's own name always matches. */
export const ALIASES: Record<string, readonly string[]> = {
  courge: ['butternut', 'courge butternut', 'courge musquée', 'potimarron', 'courge spaghetti'],
  potiron: ['citrouille'],
  chou: ['chou rouge', 'chou vert', 'chou blanc', 'chou frisé', 'kale', 'chou kale'],
  laitue: ['salade', 'batavia', 'romaine', 'feuille de chêne', 'iceberg', 'sucrine'],
  mandarine: ['satsuma'],
  manguebateau: ['mangue bateau'],
  mangue: ['mangue avion'],
  celeri: ['céleri-rave', 'céleri branche'],
  peche: ['pêche plate', 'pêche de vigne'],
  saintjacques: ['coquille saint-jacques', 'noix de saint-jacques', 'st jacques', 'saint jacques'],
  huitre: [],
  montdor: ['vacherin mont d’or'],
};

/** Names that start like a seasonal food but are not one (dried, processed, another plant). */
export const NOT_SEASONAL: readonly string[] = [
  'pomme de terre',
  'noix de cajou',
  'noix de pécan',
  'noix de muscade',
  'raisin sec',
  'abricot sec',
  'figue sèche',
  'tomate pelée',
  'tomate concassée',
  'tomate séchée',
  'salade de fruits',
  'salade composée',
  'mais doux',
  'datte sèche',
];

/**
 * In-season replacements, best first (similar use in the kitchen). Only foods listed here get a swap:
 * staples (onion, carrot, apple, lemon…) are never nagged about.
 */
export const SWAPS: Record<string, readonly string[]> = {
  // Year-round imports with a heavy footprint.
  avocat: ['courge', 'potiron', 'tomate', 'concombre', 'radis', 'asperge', 'betterave', 'mache'],
  mangue: ['kaki', 'clementine', 'kiwi', 'poire', 'peche', 'abricot', 'melon', 'fraise'],
  manguebateau: ['kaki', 'clementine', 'kiwi', 'poire', 'peche', 'abricot', 'melon', 'fraise'],
  // Summer vegetables.
  tomate: ['betterave', 'mache', 'endive', 'radis', 'concombre'],
  concombre: ['radis', 'endive', 'mache', 'celeri', 'fenouil'],
  courgette: ['courge', 'potiron', 'poireau', 'blette', 'epinard', 'asperge', 'artichaut'],
  aubergine: ['courge', 'potiron', 'choufleur', 'fenouil', 'artichaut'],
  poivron: ['fenouil', 'choufleur', 'courge', 'radis'],
  haricotvert: ['brocoli', 'choudebruxelles', 'poireau', 'epinard', 'petitpois', 'asperge'],
  petitpois: ['haricotvert', 'brocoli', 'choudebruxelles', 'epinard'],
  laitue: ['mache', 'endive', 'epinard'],
  mais: ['panais', 'courge', 'potiron'],
  artichaut: ['choufleur', 'brocoli', 'fenouil', 'asperge'],
  asperge: ['poireau', 'brocoli', 'salsifis', 'artichaut', 'haricotvert'],
  radis: ['navet', 'betterave', 'celeri', 'concombre'],
  // Winter vegetables, out of season in summer.
  courge: ['courgette', 'aubergine', 'poivron', 'petitpois'],
  potiron: ['courgette', 'aubergine', 'poivron', 'petitpois'],
  poireau: ['fenouil', 'courgette', 'blette', 'asperge'],
  chou: ['brocoli', 'courgette', 'haricotvert', 'fenouil'],
  choufleur: ['brocoli', 'artichaut', 'courgette', 'haricotvert'],
  choudebruxelles: ['brocoli', 'haricotvert', 'petitpois', 'courgette'],
  brocoli: ['choufleur', 'choudebruxelles', 'chou', 'asperge', 'haricotvert'],
  endive: ['laitue', 'concombre', 'fenouil'],
  mache: ['laitue', 'concombre', 'radis'],
  epinard: ['blette', 'laitue', 'haricotvert'],
  // Fruits.
  fraise: ['clementine', 'kiwi', 'poire', 'pomme', 'rhubarbe', 'cerise'],
  framboise: ['fraise', 'cerise', 'kiwi', 'clementine', 'poire', 'raisin'],
  myrtille: ['fraise', 'cerise', 'kiwi', 'clementine', 'poire', 'raisin'],
  cerise: ['fraise', 'abricot', 'prune', 'raisin', 'kiwi', 'clementine'],
  abricot: ['poire', 'pomme', 'raisin', 'kiwi', 'clementine', 'fraise', 'cerise', 'peche'],
  peche: ['poire', 'pomme', 'raisin', 'kiwi', 'clementine', 'fraise', 'cerise', 'abricot'],
  nectarine: ['poire', 'pomme', 'raisin', 'kiwi', 'clementine', 'fraise', 'cerise', 'abricot'],
  prune: ['poire', 'pomme', 'raisin', 'kiwi', 'clementine', 'fraise', 'cerise'],
  melon: ['raisin', 'figue', 'kaki', 'clementine', 'kiwi', 'fraise', 'cerise'],
  pasteque: ['raisin', 'figue', 'kaki', 'clementine', 'kiwi', 'fraise', 'cerise'],
  raisin: ['clementine', 'kiwi', 'poire', 'fraise', 'melon', 'peche'],
  figue: ['kaki', 'poire', 'fraise', 'abricot'],
  kiwi: ['fraise', 'cerise', 'abricot', 'peche', 'prune', 'raisin'],
  clementine: ['fraise', 'cerise', 'abricot', 'peche', 'melon', 'prune'],
  mandarine: ['fraise', 'cerise', 'abricot', 'peche', 'melon', 'prune'],
  orange: ['fraise', 'cerise', 'abricot', 'peche', 'melon', 'prune'],
  pamplemousse: ['fraise', 'cerise', 'abricot', 'peche', 'melon', 'kiwi'],
  poire: ['abricot', 'peche', 'fraise', 'cerise', 'melon'],
};
