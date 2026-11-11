/**
 * Photo → `scan-receipt` Edge Function. The photo is re-encoded on the device (orientation applied,
 * long edge ≤ 2576 px, JPEG) so the upload stays around 1 MB and the model gets a readable image.
 */
import type { Product } from '@/domain/types';
import { supabase } from '@/shared/api/supabase';
import type { ReceiptDto } from './review';

const MAX_EDGE = 2576;
const MAX_PIXELS = 4_500_000;
const QUALITY = 0.85;
const MAX_PRODUCTS = 800;

export type ReceiptErrorCode = 'offline' | 'unreadable' | 'unavailable' | 'not_configured' | 'too_large';

export class ReceiptError extends Error {
  constructor(readonly code: ReceiptErrorCode) {
    super(code);
  }
}

/** Size of the encoded photo for a source of `width × height`. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const byEdge = MAX_EDGE / Math.max(width, height);
  const byArea = Math.sqrt(MAX_PIXELS / (width * height));
  const scale = Math.min(1, byEdge, byArea);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  return btoa(binary);
}

export async function encodeReceiptPhoto(file: Blob): Promise<{ mediaType: 'image/jpeg'; data: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ReceiptError('unreadable');
  }
  const { width, height } = targetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ReceiptError('unreadable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new ReceiptError('unreadable');
  return { mediaType: 'image/jpeg', data: await toBase64(blob) };
}

/** Live products sent for matching, most recently updated first. */
export function productsForMatching(products: Iterable<Product>) {
  return [...products]
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_PRODUCTS)
    .map((p) => ({ id: p.id, name: p.name, brand: p.brand, kind: p.kind }));
}

interface FnError {
  name?: string;
  context?: { status?: number; json?: () => Promise<unknown> };
}

export async function readReceipt(
  image: { mediaType: 'image/jpeg'; data: string },
  products: ReturnType<typeof productsForMatching>,
): Promise<ReceiptDto> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ReceiptError('offline');
  const { data, error } = await supabase.functions.invoke('scan-receipt', { body: { image, products } });
  if (error) {
    const fn = error as FnError;
    if (fn.name === 'FunctionsFetchError') throw new ReceiptError('offline');
    const status = fn.context?.status;
    const body = (await fn.context?.json?.().catch(() => null)) as { code?: string } | null;
    if (status === 413) throw new ReceiptError('too_large');
    if (status === 422 || body?.code === 'unreadable_image') throw new ReceiptError('unreadable');
    if (body?.code === 'not_configured') throw new ReceiptError('not_configured');
    throw new ReceiptError('unavailable');
  }
  const receipt = (data as { receipt?: ReceiptDto } | null)?.receipt;
  if (!receipt || !Array.isArray(receipt.lines)) throw new ReceiptError('unavailable');
  return receipt;
}
