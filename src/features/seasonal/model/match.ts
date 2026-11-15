/**
 * Which seasonal food a list row or a product is. A French name matches when it *starts* with a
 * food's name or alias («Tomates cerises» → tomate, «Sauce tomate» → nothing); the longest name wins
 * («Chou-fleur» → chou-fleur, not chou). Plurals and accents are ignored.
 *
 * English and Swedish names match only as the whole text («Tomatoes», «2 kg tomater»): English puts
 * the food first in processed products («Tomato soup», «Apple juice»), so a prefix would be wrong.
 * Every language is recognised whatever the active one: a household may mix them.
 */
import type { CategoryKey } from '@/domain/types';
import { fold } from '@/shared/i18n';
import { ALIASES, NOT_SEASONAL, SEASONAL_FOODS } from './catalog';
import { englishSingular, FOOD_NAMES_EN, FOOD_NAMES_SV, FOOD_SINGULARS_SV } from './names';

/** Words a free-text row may start with before the food itself («2 kg de tomates», «barquette de fraises»). */
const LEADING = new Set([
  'de',
  'des',
  'du',
  'd',
  'la',
  'le',
  'les',
  'l',
  'un',
  'une',
  'quelques',
  'kg',
  'g',
  'gr',
  'x',
  'bio',
  'botte',
  'barquette',
  'filet',
  'sachet',
  'sac',
  'boite',
  'pot',
  'cagette',
  'douzaine',
]);

/** Categories whose products can be a fresh seasonal food (jams, juices, frozen and canned food cannot). */
const FRESH_CATEGORIES: ReadonlySet<CategoryKey> = new Set(['legumes', 'fruits', 'poisson', 'laitier']);

function singular(word: string): string {
  return word.length > 3 && (word.endsWith('s') || word.endsWith('x')) ? word.slice(0, -1) : word;
}

export function tokens(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(singular);
}

interface Term {
  words: readonly string[];
  slug: string | null;
  /** The name must be the whole text, not only its beginning. */
  whole?: boolean;
}

const stripNote = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

let terms: readonly Term[] | null = null;

function allTerms(): readonly Term[] {
  if (terms) return terms;
  const out: Term[] = [];
  for (const e of SEASONAL_FOODS) {
    for (const name of [stripNote(e.name), ...(ALIASES[e.slug] ?? [])]) {
      out.push({ words: tokens(name), slug: e.slug });
    }
    const english = FOOD_NAMES_EN[e.slug];
    const swedish = FOOD_NAMES_SV[e.slug];
    const translated = [
      ...(english ? [stripNote(english), englishSingular(stripNote(english))] : []),
      ...(swedish ? [stripNote(swedish)] : []),
      ...(FOOD_SINGULARS_SV[e.slug] ? [FOOD_SINGULARS_SV[e.slug] as string] : []),
    ];
    for (const name of translated) out.push({ words: tokens(name), slug: e.slug, whole: true });
  }
  for (const name of NOT_SEASONAL) out.push({ words: tokens(name), slug: null });
  // Longest first, so the first match is the most specific; a name keeps the first food it was given.
  terms = out.filter((t) => t.words.length > 0).sort((a, b) => b.words.length - a.words.length);
  return terms;
}

/** Seasonal food of a free-text name, or null. */
export function foodOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = tokens(text);
  let start = 0;
  while (start < words.length && (LEADING.has(words[start] ?? '') || /^\d/.test(words[start] ?? ''))) start++;
  // A whole-text name may still carry a trailing note: «Mango (air-freighted)».
  const wholeLength = tokens(stripNote(text)).length - start;
  for (const term of allTerms()) {
    if (term.whole && wholeLength !== term.words.length) continue;
    if (term.words.every((w, i) => words[start + i] === w)) return term.slug;
  }
  return null;
}

/**
 * Seasonal food of a household product: its kind first (the classifier's generic name), then its
 * name; never for a category that cannot hold fresh food.
 */
export function foodOfProduct(p: {
  kind: string | null;
  name: string;
  categoryKey: CategoryKey | null;
}): string | null {
  if (p.categoryKey !== null && !FRESH_CATEGORIES.has(p.categoryKey)) return null;
  return foodOf(p.kind) ?? foodOf(p.name);
}
