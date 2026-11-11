/**
 * Prompt, output schema and answer validation of `classify-product`. Pure, so it is unit-tested
 * without the network (prompt_test.ts).
 */

/** The 28 category slugs with their French labels (migration 03, `category_templates`). */
export const CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['legumes', 'Légumes'],
  ['fruits', 'Fruits'],
  ['feculents', 'Pâtes, riz & céréales'],
  ['poisson', 'Poisson'],
  ['viande', 'Viande & charcuterie'],
  ['laitier', 'Produits laitiers & œufs'],
  ['pain', 'Pain & viennoiseries'],
  ['apero', 'Apéritifs & snacks salés'],
  ['epicerie_sucree', 'Épicerie sucrée'],
  ['chocolat', 'Chocolat & confiserie'],
  ['petit_dej', 'Petit-déjeuner & tartinables'],
  ['conserves', 'Conserves'],
  ['surgeles', 'Surgelés'],
  ['plats', 'Plats préparés & soupes'],
  ['soft', 'Boissons sans alcool'],
  ['jus', 'Jus & nectars'],
  ['eau', 'Eaux'],
  ['vin', 'Vins'],
  ['biere', 'Bières, cidres & spiritueux'],
  ['cafe', 'Café & thé'],
  ['condiments', 'Condiments, sauces & huiles'],
  ['bebe', 'Bébé'],
  ['animaux', 'Animaux'],
  ['entretien', 'Entretien & nettoyage'],
  ['hygiene', 'Hygiène & beauté'],
  ['papier', 'Papier & jetables'],
  ['pharmacie', 'Pharmacie & compléments'],
  ['autre', 'Autre'],
];
const CATEGORY_KEYS = new Set(CATEGORIES.map(([k]) => k));

export const LIMITS = { maxItems: 25, maxKinds: 300, maxExamples: 40, maxText: 200 } as const;

export interface ClassifyItem {
  id: string;
  name: string;
  brand: string | null;
  /** Category from the catalogue rules, when they gave one (context only). */
  categoryKey: string | null;
}

export interface ClassifyExample {
  name: string;
  kind: string;
  categoryKey: string | null;
}

export interface ClassifyRequest {
  items: ClassifyItem[];
  /** Kinds already used by the household: the model reuses one when the item is the same thing. */
  kinds: string[];
  /** Members' own corrections, most recent first. */
  examples: ClassifyExample[];
}

export interface ClassifyResult {
  id: string;
  kind: string;
  categoryKey: string;
  suggestedMin: number;
}

export const SYSTEM_PROMPT = `Tu ranges les articles du cellier d'un foyer français (application Cellier).

Pour chaque article, donne :
- "kind" : le type générique de produit, celui qu'on écrirait sur une liste de courses. En français, en minuscules, au singulier, sans marque, sans origine, sans variété, sans format ni quantité. Deux articles interchangeables pour le foyer ont le même type : « Café moulu Éthiopie Moka 250 g » et « Café moulu Colombie bio » sont tous les deux « café moulu ». Garde les distinctions qui changent l'achat : « café moulu », « café en grains » et « café en capsules » sont trois types ; « lait demi-écrémé » et « lait d'avoine » aussi.
- "categoryKey" : une des clés de catégorie listées ci-dessous. N'utilise « autre » que si aucune ne convient.
- "suggestedMin" : le seuil conseillé, c'est-à-dire le nombre d'unités (paquets, bouteilles, boîtes, comme le foyer les compte) en dessous duquel il faut en racheter. 1 pour la plupart des produits ; davantage pour ce qui se consomme vite ou par lots (eau en bouteilles, papier toilette, lait) ; 0 pour ce qu'on n'a pas besoin d'avoir en permanence (produits d'occasion, apéritifs, alcools).

Si un type de la liste « Types déjà utilisés » désigne la même chose, reprends-le exactement, à la lettre. Les corrections du foyer priment : un article semblable à un exemple corrigé reçoit le même type et la même catégorie.

Catégories :
${CATEGORIES.map(([k, label]) => `- ${k} : ${label}`).join('\n')}

Réponds pour chaque article reçu, avec son "id".`;

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          categoryKey: { type: 'string', enum: CATEGORIES.map(([k]) => k) },
          suggestedMin: { type: 'integer' },
        },
        required: ['id', 'kind', 'categoryKey', 'suggestedMin'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

const clip = (s: string) => s.trim().slice(0, LIMITS.maxText);

/** The user message: household context, then the items. Deterministic order for caching. */
export function userMessage(req: ClassifyRequest): string {
  const kinds = [...new Set(req.kinds.map(clip).filter(Boolean))].sort().slice(0, LIMITS.maxKinds);
  const parts: string[] = [];
  parts.push(`Types déjà utilisés :\n${kinds.length ? kinds.map((k) => `- ${k}`).join('\n') : '(aucun)'}`);
  if (req.examples.length > 0) {
    parts.push(
      `Corrections du foyer :\n${req.examples
        .slice(0, LIMITS.maxExamples)
        .map((e) => `- « ${clip(e.name)} » → type « ${clip(e.kind)} »${e.categoryKey ? `, catégorie ${e.categoryKey}` : ''}`)
        .join('\n')}`,
    );
  }
  parts.push(
    `Articles :\n${JSON.stringify(
      req.items.map((i) => ({
        id: i.id,
        name: clip(i.name),
        ...(i.brand ? { brand: clip(i.brand) } : {}),
        ...(i.categoryKey ? { catalogueCategory: i.categoryKey } : {}),
      })),
    )}`,
  );
  return parts.join('\n\n');
}

/** Parses the request body; null when it is malformed. */
export function parseRequest(body: unknown): ClassifyRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > LIMITS.maxItems) return null;
  const items: ClassifyItem[] = [];
  for (const raw of b.items) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length > 64 || typeof r.name !== 'string' || r.name.trim() === '') return null;
    items.push({
      id: r.id,
      name: r.name,
      brand: typeof r.brand === 'string' ? r.brand : null,
      categoryKey: typeof r.categoryKey === 'string' && CATEGORY_KEYS.has(r.categoryKey) ? r.categoryKey : null,
    });
  }
  const kinds = Array.isArray(b.kinds) ? b.kinds.filter((k): k is string => typeof k === 'string') : [];
  const examples: ClassifyExample[] = [];
  if (Array.isArray(b.examples)) {
    for (const raw of b.examples) {
      const r = raw as Record<string, unknown> | null;
      if (r && typeof r.name === 'string' && typeof r.kind === 'string') {
        examples.push({
          name: r.name,
          kind: r.kind,
          categoryKey: typeof r.categoryKey === 'string' && CATEGORY_KEYS.has(r.categoryKey) ? r.categoryKey : null,
        });
      }
    }
  }
  return { items, kinds, examples };
}

/** Keeps the answers that match a requested id and are well formed; normalises the kind. */
export function validateResults(raw: unknown, requested: readonly ClassifyItem[]): ClassifyResult[] {
  const ids = new Set(requested.map((i) => i.id));
  const out: ClassifyResult[] = [];
  const seen = new Set<string>();
  const list = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return out;
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || typeof r.id !== 'string' || !ids.has(r.id) || seen.has(r.id)) continue;
    const kind = typeof r.kind === 'string' ? r.kind.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60) : '';
    const key = typeof r.categoryKey === 'string' && CATEGORY_KEYS.has(r.categoryKey) ? r.categoryKey : null;
    const min = typeof r.suggestedMin === 'number' && Number.isFinite(r.suggestedMin) ? Math.round(r.suggestedMin) : 1;
    if (!kind || !key) continue;
    seen.add(r.id);
    out.push({ id: r.id, kind, categoryKey: key, suggestedMin: Math.min(99, Math.max(0, min)) });
  }
  return out;
}
