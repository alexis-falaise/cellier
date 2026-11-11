/**
 * ItemEditSheet and NewItemSheet form model (design 03 §4.5.5, §4.7): text inputs as typed, the
 * validation rules, and the diff written by «Enregistrer» (only changed fields are sent, so a
 * concurrent edit of another field by another member is kept, 02 §3 per-field LWW).
 */
import type { CategoryId, NetUnit, Product, ProductFields } from '@/domain/types';
import { fold } from '@/shared/i18n';

/** Units offered by the «Unité» control; stored as g, ml or piece. */
export type FormUnit = 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'piece';
export const FORM_UNITS: readonly FormUnit[] = ['g', 'kg', 'ml', 'cl', 'l', 'piece'];

const FACTOR: Record<FormUnit, { base: NetUnit; factor: number }> = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  cl: { base: 'ml', factor: 10 },
  l: { base: 'ml', factor: 1000 },
  piece: { base: 'piece', factor: 1 },
};

export interface ItemForm {
  name: string;
  brand: string;
  categoryId: string | null;
  /** «Type» (kind), as typed; '' = none. */
  kind: string;
  /** «Quantité» of «Contenance», as typed («1,5»). */
  size: string;
  unit: FormUnit;
  /** «Prix unitaire» in euros, as typed («1,89»). */
  price: string;
  minQuantity: number | null;
  /** null = computed («Calculé»). */
  usualQuantity: number | null;
}

export interface ItemFormErrors {
  name?: 'required' | 'taken';
  size?: 'positive';
  price?: 'positive';
}

const decimalText = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3, useGrouping: false });
const priceText = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** «1,5» / «1.5» / « 2 » → number; '' → null; anything else → NaN. */
export function parseDecimal(text: string): number | null {
  const s = text.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Stored size → the unit shown: 1500 g reads «1,5 kg», 750 ml reads «75 cl», 1000 ml reads «1 L». */
export function sizeForDisplay(netQuantity: number | null, netUnit: NetUnit | null): { size: string; unit: FormUnit } {
  const unit: FormUnit = netUnit ?? 'g';
  if (netQuantity === null) return { size: '', unit };
  let shown: FormUnit = unit;
  if (unit === 'g' && netQuantity >= 1000) shown = 'kg';
  if (unit === 'ml' && netQuantity >= 1000) shown = 'l';
  else if (unit === 'ml' && netQuantity % 10 === 0) shown = 'cl';
  return { size: decimalText.format(netQuantity / FACTOR[shown].factor), unit: shown };
}

/** Typed size → stored `netQuantity` / `netUnit` (null when empty or invalid). */
export function sizeToStored(size: string, unit: FormUnit): { netQuantity: number | null; netUnit: NetUnit | null } {
  const value = parseDecimal(size);
  if (value === null || !Number.isFinite(value) || value <= 0) return { netQuantity: null, netUnit: null };
  const { base, factor } = FACTOR[unit];
  return { netQuantity: Math.round(value * factor * 1000) / 1000, netUnit: base };
}

/** Typed euros → cents (null when empty or invalid). */
export function priceToCents(price: string): number | null {
  const value = parseDecimal(price);
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formFromProduct(product: Product): ItemForm {
  const { size, unit } = sizeForDisplay(product.netQuantity, product.netUnit);
  return {
    name: product.name,
    brand: product.brand ?? '',
    categoryId: product.categoryId,
    kind: product.kind ?? '',
    size,
    unit,
    price: product.priceCents === null ? '' : priceText.format(product.priceCents / 100),
    minQuantity: product.minQuantity,
    usualQuantity: product.usualQuantity,
  };
}

/** Names are unique per household, ignoring case and accents. */
export function nameTaken(
  name: string,
  products: ReadonlyArray<Pick<Product, 'id' | 'name'>>,
  selfId: string | null,
): Pick<Product, 'id' | 'name'> | null {
  const key = fold(name.trim());
  if (!key) return null;
  return products.find((p) => p.id !== selfId && fold(p.name.trim()) === key) ?? null;
}

export function validateItemForm(
  form: Pick<ItemForm, 'name' | 'size' | 'price'>,
  products: ReadonlyArray<Pick<Product, 'id' | 'name'>>,
  selfId: string | null,
): ItemFormErrors {
  const errors: ItemFormErrors = {};
  if (!form.name.trim()) errors.name = 'required';
  else if (nameTaken(form.name, products, selfId)) errors.name = 'taken';
  const size = parseDecimal(form.size);
  if (size !== null && !(Number.isFinite(size) && size > 0)) errors.size = 'positive';
  const price = parseDecimal(form.price);
  if (price !== null && !(Number.isFinite(price) && price >= 0)) errors.price = 'positive';
  return errors;
}

export function hasErrors(errors: ItemFormErrors): boolean {
  return errors.name !== undefined || errors.size !== undefined || errors.price !== undefined;
}

/** Fields of `form` that differ from `product`; empty when nothing changed. */
export function itemFormDiff(product: Product, form: ItemForm): ProductFields {
  const fields: ProductFields = {};
  const name = form.name.trim();
  if (name && name !== product.name) fields.name = name;
  const brand = form.brand.trim() || null;
  if (brand !== product.brand) fields.brand = brand;
  if (form.categoryId !== product.categoryId) {
    fields.categoryId = form.categoryId as CategoryId | null;
    fields.categorySource = 'user';
  }
  const kind = form.kind.trim().replace(/\s+/g, ' ') || null;
  if (kind !== product.kind) {
    fields.kind = kind;
    fields.kindSource = kind === null ? null : 'user';
  }
  const { netQuantity, netUnit } = sizeToStored(form.size, form.unit);
  if (netQuantity !== product.netQuantity || (netQuantity !== null && netUnit !== product.netUnit)) {
    fields.netQuantity = netQuantity;
    fields.netUnit = netUnit;
  }
  const cents = priceToCents(form.price);
  if (cents !== product.priceCents) {
    fields.priceCents = cents;
    fields.priceSource = cents === null ? null : 'user';
  }
  if (form.minQuantity !== product.minQuantity) fields.minQuantity = form.minQuantity;
  if (form.usualQuantity !== product.usualQuantity) fields.usualQuantity = form.usualQuantity;
  return fields;
}

/** Products whose name contains every typed word (accent- and case-insensitive), at most `limit`. */
export function matchingProducts<P extends Pick<Product, 'name'>>(
  query: string,
  products: readonly P[],
  limit = 5,
): P[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: P[] = [];
  for (const p of products) {
    const name = fold(p.name);
    if (words.every((w) => name.includes(w))) {
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}
