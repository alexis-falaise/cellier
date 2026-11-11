/**
 * Prompt, output schema and answer validation of `scan-receipt`. Pure, so it is unit-tested without
 * the network (prompt_test.ts).
 */

export const LIMITS = {
  /** Base64 characters of the photo (≈ 6 MB of JPEG). */
  maxImageChars: 8_000_000,
  maxProducts: 800,
  maxText: 120,
  maxLines: 150,
} as const;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export interface HouseholdProduct {
  id: string;
  name: string;
  brand: string | null;
  kind: string | null;
}

export interface ReceiptRequest {
  image: { mediaType: ImageType; data: string };
  products: HouseholdProduct[];
}

export interface ReceiptLine {
  /** The line as printed (abbreviations kept). */
  label: string;
  /** Readable French name, abbreviations expanded («Lait demi-écrémé 1 L»). */
  name: string;
  quantity: number;
  /** Unit price paid after the line's discounts, in cents. */
  unitPriceCents: number | null;
  totalCents: number | null;
  /** Household product this line is, when one clearly matches. */
  productId: string | null;
  /** Not something kept in a cellar (bag, deposit, service, voucher). */
  skip: boolean;
}

export interface ReceiptResult {
  store: string | null;
  /** `YYYY-MM-DD` printed on the receipt. */
  purchasedOn: string | null;
  totalCents: number | null;
  lines: ReceiptLine[];
}

export const SYSTEM_PROMPT = `Tu lis des tickets de caisse de supermarchés français (E.Leclerc, Carrefour, Intermarché, Auchan, Lidl, Monoprix…) pour l'application Cellier, qui tient l'inventaire du cellier d'un foyer.

À partir de la photo du ticket, donne :
- "store" : l'enseigne et la ville si elles sont lisibles (« Carrefour Market Annecy »), sinon null.
- "purchasedOn" : la date d'achat au format AAAA-MM-JJ, sinon null.
- "totalCents" : le total payé en centimes, sinon null.
- "lines" : un élément par article acheté, dans l'ordre du ticket.

Pour chaque article :
- "label" : le libellé tel qu'il est imprimé, abréviations comprises (« LAIT DEMI ECR UHT 1L »).
- "name" : un nom lisible en français, abréviations développées, avec la marque et le format quand ils figurent (« Lait demi-écrémé UHT 1 L »).
- "quantity" : le nombre d'unités achetées. Une ligne « 3 x 1,25 » sous l'article veut dire 3. Un produit pesé (« 0,532 kg x 3,99 €/kg ») compte pour 1.
- "unitPriceCents" : le prix payé pour une unité, en centimes, après les remises qui portent sur cette ligne (« REMISE », « PROMO », « -30% », « 2e à -50% » répartie sur les unités concernées). Les avantages crédités sur une carte de fidélité ne sont pas des remises. null si illisible.
- "totalCents" : le montant de la ligne en centimes après remises, null si illisible.
- "productId" : l'id du produit du foyer qui correspond à cet article, seulement si c'est clairement le même produit (même chose, même format à peu près ; la marque peut manquer sur le ticket). Sinon null. Ne devine pas.
- "skip" : true pour ce qui ne se range pas dans un cellier : sacs, consignes, services, cartes cadeaux, bons d'achat. false sinon.

Ignore les lignes qui ne sont pas des articles : sous-totaux, total, moyens de paiement, TVA, rendu monnaie, cumul fidélité. Une ligne de remise seule n'est pas un article : applique-la à l'article qu'elle concerne. Si deux lignes identiques se suivent, garde-les séparées.`;

const nullable = (type: string) => ({ type: [type, 'null'] });

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    store: nullable('string'),
    purchasedOn: nullable('string'),
    totalCents: nullable('integer'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          name: { type: 'string' },
          quantity: { type: 'integer' },
          unitPriceCents: nullable('integer'),
          totalCents: nullable('integer'),
          productId: nullable('string'),
          skip: { type: 'boolean' },
        },
        required: ['label', 'name', 'quantity', 'unitPriceCents', 'totalCents', 'productId', 'skip'],
        additionalProperties: false,
      },
    },
  },
  required: ['store', 'purchasedOn', 'totalCents', 'lines'],
  additionalProperties: false,
} as const;

const clip = (s: string, max: number = LIMITS.maxText) => s.trim().replace(/\s+/g, ' ').slice(0, max);

/** The household's products, sorted by id so the text block is stable across calls (prompt cache). */
export function productsMessage(products: readonly HouseholdProduct[]): string {
  const rows = [...products]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const extra = [p.brand ? clip(p.brand) : null, p.kind ? `type : ${clip(p.kind)}` : null].filter(Boolean);
      return `${p.id} | ${clip(p.name)}${extra.length ? ` (${extra.join(', ')})` : ''}`;
    });
  return `Produits du foyer (id | nom) :\n${rows.length ? rows.join('\n') : '(aucun)'}`;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Parses the request body; null when it is malformed. */
export function parseRequest(body: unknown): ReceiptRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const image = b.image as Record<string, unknown> | undefined;
  if (!image || typeof image.data !== 'string' || typeof image.mediaType !== 'string') return null;
  if (!(IMAGE_TYPES as readonly string[]).includes(image.mediaType)) return null;
  if (image.data.length === 0 || image.data.length > LIMITS.maxImageChars || !BASE64.test(image.data)) return null;
  const products: HouseholdProduct[] = [];
  if (Array.isArray(b.products)) {
    for (const raw of b.products.slice(0, LIMITS.maxProducts)) {
      const r = raw as Record<string, unknown> | null;
      if (!r || typeof r.id !== 'string' || r.id.length > 64 || typeof r.name !== 'string' || !r.name.trim()) continue;
      products.push({
        id: r.id,
        name: r.name,
        brand: typeof r.brand === 'string' && r.brand.trim() ? r.brand : null,
        kind: typeof r.kind === 'string' && r.kind.trim() ? r.kind : null,
      });
    }
  }
  return { image: { mediaType: image.mediaType as ImageType, data: image.data }, products };
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Keeps well-formed lines; drops product ids that were not sent; clamps numbers. */
export function validateResult(raw: unknown, products: readonly HouseholdProduct[]): ReceiptResult {
  const ids = new Set(products.map((p) => p.id));
  const r = (raw ?? {}) as Record<string, unknown>;
  const lines: ReceiptLine[] = [];
  const list = Array.isArray(r.lines) ? (r.lines as Array<Record<string, unknown>>) : [];
  for (const l of list.slice(0, LIMITS.maxLines)) {
    if (!l || typeof l.label !== 'string' || !l.label.trim()) continue;
    const label = clip(l.label);
    const name = typeof l.name === 'string' && l.name.trim() ? clip(l.name) : label;
    const quantity = int(l.quantity, 1, 999) ?? 1;
    const unit = int(l.unitPriceCents, 0, 10_000_000);
    const total = int(l.totalCents, -10_000_000, 10_000_000);
    lines.push({
      label,
      name,
      quantity,
      unitPriceCents: unit ?? (total !== null && total >= 0 ? Math.round(total / quantity) : null),
      totalCents: total,
      productId: typeof l.productId === 'string' && ids.has(l.productId) ? l.productId : null,
      skip: l.skip === true,
    });
  }
  const store = typeof r.store === 'string' && r.store.trim() ? clip(r.store, 60) : null;
  const purchasedOn = typeof r.purchasedOn === 'string' && DATE.test(r.purchasedOn) ? r.purchasedOn : null;
  return { store, purchasedOn, totalCents: int(r.totalCents, 0, 100_000_000), lines };
}
