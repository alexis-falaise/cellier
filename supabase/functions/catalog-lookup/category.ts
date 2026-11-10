/**
 * Category mapping, section 5.3.
 *
 * TODO(catalogue rules): the rules artefact `supabase/functions/_shared/catalogue/category-rules.json`
 * (section 5.1, built by scripts/catalogue/build-category-rules.ts) does not exist yet. Until it
 * does, `CATEGORY_RULES` is null and every product is written with `category_key = null` and
 * `category_rule = null` (the client then falls back to the household's `autre` category,
 * section 5.4). When the artefact lands: import it here
 * (`import rules from '../_shared/catalogue/category-rules.json' with { type: 'json' };`) and set
 * `CATEGORY_RULES = rules as CategoryRulesArtefact`. Rows written meanwhile have a null
 * `category_rule` and are picked up by the re-classification of section 5.6.
 */
import type { CategoryMappingInput, CategoryMappingResult, CategoryRulesArtefact } from './types.ts';
import { fold } from './retailers.ts';

export const CATEGORY_RULES: CategoryRulesArtefact | null = null;

/** `fr:Liquide vaisselle` -> `fr:liquide-vaisselle`: lower-case prefix, slugified rest. */
export function canonicalTagForm(tag: string): string {
  const i = tag.indexOf(':');
  const prefix = i > 0 ? tag.slice(0, i).toLowerCase().trim() : '';
  const rest = i > 0 ? tag.slice(i + 1) : tag;
  const slug = fold(rest).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return prefix ? `${prefix}:${slug}` : slug;
}

const MAX_TRACE = 120;

function trace(version: number, body: string): string {
  const t = `v${version}|${body}`;
  return t.length > MAX_TRACE ? t.slice(0, MAX_TRACE) : t;
}

export function mapCategory(input: CategoryMappingInput, rules: CategoryRulesArtefact): CategoryMappingResult {
  const ignored = new Set(rules.ignoredTags);

  // 1. Canonicalise.
  const canonical: Array<{ tag: string; pos: number }> = [];
  input.categoriesTags.forEach((raw, pos) => {
    const t = canonicalTagForm(raw);
    if (ignored.has(t)) return;
    if (t in rules.depth) canonical.push({ tag: t, pos });
    else if (t in rules.synonyms) {
      const s = rules.synonyms[t];
      if (!ignored.has(s)) canonical.push({ tag: s, pos });
    }
  });

  // 2. Deepest first; ties: later position first.
  canonical.sort((a, b) => (rules.depth[b.tag] ?? 0) - (rules.depth[a.tag] ?? 0) || b.pos - a.pos);

  // 3. Tiers.
  for (const tier of ['tier0', 'tier1', 'tier2'] as const) {
    const table = rules.tagRules[tier];
    for (const { tag } of canonical) {
      if (tag in table) return { categoryKey: table[tag], categoryRule: trace(rules.version, `${tier}:${tag}`) };
      for (const anc of rules.ancestors[tag] ?? []) {
        if (anc in table) return { categoryKey: table[anc], categoryRule: trace(rules.version, `${tier}:${anc}`) };
      }
    }
  }

  // 4. Food groups: level 2 before level 1, i.e. the deepest value.
  const groups = input.foodGroupsTags.filter((g) => !g.startsWith('en:unknown-food-group'));
  // food_groups_tags lists level 1 then level 2, so the later entry is the deeper one.
  for (const g of [...groups].reverse()) {
    if (g in rules.foodGroups) return { categoryKey: rules.foodGroups[g], categoryRule: trace(rules.version, `fg:${g}`) };
  }

  // 5. pnns, only when food groups are empty.
  if (input.foodGroupsTags.length === 0) {
    const p2 = input.pnnsGroups2;
    if (p2 && p2 !== 'unknown' && p2 in rules.pnns2) {
      return { categoryKey: rules.pnns2[p2], categoryRule: trace(rules.version, `pnns2:${p2}`) };
    }
    const p1 = input.pnnsGroups1;
    if (p1 && p1 !== 'unknown' && p1 in rules.pnns1) {
      return { categoryKey: rules.pnns1[p1], categoryRule: trace(rules.version, `pnns1:${p1}`) };
    }
  }

  // 6. Name regular expressions.
  for (let i = 0; i < rules.nameRegexes.length; i++) {
    const r = rules.nameRegexes[i];
    if (new RegExp(r.pattern, 'iu').test(input.name)) {
      return { categoryKey: r.categoryKey, categoryRule: trace(rules.version, `name:${i}`) };
    }
  }

  // 7. Database default.
  const def = rules.databaseDefaults[input.source];
  if (def) return { categoryKey: def, categoryRule: trace(rules.version, `db:${input.source}`) };

  // 8. Fallback.
  return { categoryKey: rules.finalFallback, categoryRule: trace(rules.version, 'fallback') };
}
