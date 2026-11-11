import { Camera, ReceiptText, ScanBarcode } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '@/app/toasts';
import type { Pantry, PantryId, Product, ProductId } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { receiptLabelMemory } from '@/features/prices';
import { formatPriceCents, formatShortDate, t } from '@/shared/i18n';
import type { ScannedCode } from '@/shared/lib/gtin';
import { haptic } from '@/shared/lib/haptics';
import {
  type CellierSnapshot,
  getSyncStore,
  MutationValidationError,
  mutate,
  syncActions,
  useStore,
} from '@/shared/sync';
import { openGroceryEntryFor } from '@/shared/sync/reducers';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ListSection,
  QuantityStepper,
  RowSeparator,
  Sheet,
  Spinner,
} from '@/shared/ui';
import {
  encodeReceiptPhoto,
  productsForMatching,
  ReceiptError,
  type ReceiptErrorCode,
  readReceipt,
} from '../model/api';
import { resolveBarcode } from '../model/resolve';
import {
  buildReview,
  defaultPantryFor,
  isWritable,
  needsProduct,
  planReceipt,
  type ReceiptDto,
  type ReviewContext,
  type ReviewLine,
  writableUnits,
} from '../model/review';
import { LineBarcodeScanner } from './LineBarcodeScanner';
import { PantrySelect } from './PantrySelect';

export interface ReceiptSheetProps {
  open: boolean;
  /** The photo to read; a new photo restarts the review. */
  photo: File | null;
  pantries: readonly Pantry[];
  /** The cellier selected in the app, if any. */
  currentPantryId: PantryId | null;
  onClose: () => void;
  /** «Reprendre une photo». */
  onRetake: () => void;
}

type Phase =
  | { kind: 'reading' }
  | { kind: 'error'; code: ReceiptErrorCode }
  | { kind: 'review'; receipt: ReceiptDto; receiptId: string };

const selectProducts = (s: CellierSnapshot) => s.rows.product;

function reviewContext(
  snapshot: CellierSnapshot,
  pantries: readonly Pantry[],
  fallback: PantryId | null,
): ReviewContext {
  const products = snapshot.rows.product;
  const isLiveProduct = (id: string) => products.get(id as ProductId)?.deletedAt === null;
  const movements = [...snapshot.rows.movement.values()];
  const restocks = movements
    .filter((m) => m.kind === 'restock')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => ({ pantryId: m.pantryId, productId: m.productId }));
  return {
    isLiveProduct,
    memory: receiptLabelMemory(movements, isLiveProduct),
    pantryIds: pantries.map((p) => p.id),
    stock: snapshot.rows.stock.values(),
    restocks,
    fallbackPantryId: fallback,
  };
}

/**
 * «Ticket de caisse» (receipt review): the photo is read by the `scan-receipt` function, then every
 * line is shown with its product, quantity, price and cellier. Lines the reader could not match are
 * identified by scanning their barcode, or ignored. «Ranger» writes one priced restock per line,
 * updates each product's price, and closes their Courses entries; one toast undoes it all.
 */
export function ReceiptSheet({ open, photo, pantries, currentPantryId, onClose, onRetake }: ReceiptSheetProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [scanning, setScanning] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const products = useStore(selectProducts);
  const categories = useCategories();
  const fallback = currentPantryId ?? pantries[0]?.id ?? null;

  // Read the photo once per photo. Celliers are read through a ref so a sync update does not restart it.
  const contextArgs = useRef({ pantries, fallback });
  contextArgs.current = { pantries, fallback };
  const readFor = useRef<File | null>(null);
  useEffect(() => {
    if (!open || !photo || readFor.current === photo) return;
    readFor.current = photo;
    let cancelled = false;
    setPhase({ kind: 'reading' });
    setLines([]);
    void (async () => {
      try {
        const image = await encodeReceiptPhoto(photo);
        const snapshot = getSyncStore().getSnapshot();
        const receipt = await readReceipt(image, productsForMatching(snapshot.rows.product.values()));
        if (cancelled) return;
        const args = contextArgs.current;
        const ctx = reviewContext(getSyncStore().getSnapshot(), args.pantries, args.fallback);
        setLines(buildReview(receipt, ctx));
        setPhase({ kind: 'review', receipt, receiptId: crypto.randomUUID() });
        haptic('commit');
      } catch (error) {
        if (cancelled) return;
        console.warn('[receipt] read failed', error);
        setPhase({ kind: 'error', code: error instanceof ReceiptError ? error.code : 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
      readFor.current = null;
    };
  }, [open, photo]);

  const update = (key: string, patch: Partial<ReviewLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const setAll = (pantryId: PantryId) =>
    setLines((prev) => prev.map((l) => (l.included && l.productId ? { ...l, pantryId } : l)));

  const toIdentify = lines.filter(needsProduct);
  const recognized = lines.filter((l) => l.included && l.productId !== null);
  const ignored = lines.filter((l) => !l.included);
  const units = writableUnits(lines);
  const pantryOfAll = useMemo(() => {
    const ids = new Set(recognized.map((l) => l.pantryId));
    return ids.size === 1 ? ([...ids][0] ?? null) : null;
  }, [recognized]);
  const scanLine = lines.find((l) => l.key === scanning) ?? null;
  const reviewing = phase.kind === 'review';
  const dirty = reviewing && units > 0;

  const productName = (id: ProductId | null) => (id ? (products.get(id)?.name ?? null) : null);

  const onCode = async (code: ScannedCode): Promise<boolean> => {
    const line = scanLine;
    if (!line) return false;
    try {
      const result = await resolveBarcode(code, { name: line.name, categories });
      if (result.kind !== 'product') return false;
      const ctx = reviewContext(getSyncStore().getSnapshot(), pantries, fallback);
      update(line.key, {
        productId: result.productId,
        match: 'scan',
        included: true,
        pantryId: defaultPantryFor(result.productId, ctx),
      });
      setScanning(null);
      return true;
    } catch (error) {
      console.warn('[receipt] barcode not resolved', error);
      return false;
    }
  };

  const confirm = () => {
    if (phase.kind !== 'review') return;
    const snapshot = getSyncStore().getSnapshot();
    const reader = getSyncStore().reader();
    const plan = planReceipt(lines, {
      receiptId: phase.receiptId,
      store: phase.receipt.store,
      product: (id) => snapshot.rows.product.get(id) as Product | undefined,
      openGroceryEntry: (id) => openGroceryEntryFor(reader, id),
    });
    const done: ReturnType<typeof mutate>[] = [];
    for (const step of plan) {
      try {
        done.push(mutate(step.name, step.args as never));
      } catch (error) {
        if (!(error instanceof MutationValidationError)) throw error;
        console.warn('[receipt] write refused', error);
      }
    }
    onClose();
    if (done.length === 0) return;
    haptic('commit');
    showToast({
      message: t('toast.receipt', { n: units }),
      action: {
        label: t('common.undo'),
        onPress: () => {
          void (async () => {
            for (const id of [...done].reverse()) await syncActions.undo(id).catch(() => undefined);
          })();
        },
      },
    });
  };

  const meta =
    phase.kind === 'review' && (phase.receipt.store || phase.receipt.purchasedOn)
      ? [
          phase.receipt.store,
          phase.receipt.purchasedOn ? formatShortDate(new Date(`${phase.receipt.purchasedOn}T12:00:00`)) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        detents={['large']}
        title={t('receipt.title')}
        closeLabel={t('common.close')}
        dirty={dirty}
        onDismissBlocked={() => setConfirmDiscard(true)}
        footer={
          reviewing && lines.length > 0 ? (
            <Button fullWidth size="large" disabled={units === 0} onClick={confirm}>
              {units > 0 ? t('receipt.confirm', { n: units }) : t('receipt.nothing')}
            </Button>
          ) : null
        }
      >
        {phase.kind === 'reading' ? (
          <div className="flex flex-col items-center gap-4 px-8 pt-[12vh] pb-12 text-center">
            <Spinner size={28} label={t('receipt.reading')} />
            <p className="type-headline text-label-primary">{t('receipt.reading')}</p>
            <p className="type-subhead text-label-secondary">{t('receipt.readingBody')}</p>
          </div>
        ) : phase.kind === 'error' ? (
          <EmptyState
            className="pt-[10vh] pb-12"
            icon={ReceiptText}
            title={t('receipt.title')}
            body={t(`receipt.error.${phase.code}`)}
            action={{ label: t('receipt.retake'), onPress: onRetake }}
          />
        ) : lines.length === 0 ? (
          <EmptyState
            className="pt-[10vh] pb-12"
            icon={ReceiptText}
            title={t('receipt.empty')}
            action={{ label: t('receipt.retake'), onPress: onRetake }}
          />
        ) : (
          <div className="flex flex-col gap-6 pb-6">
            {meta ? <p className="px-8 type-subhead text-label-secondary">{meta}</p> : null}

            {pantries.length >= 2 && recognized.length > 0 ? (
              <ListSection label={t('receipt.allInto')}>
                {/* biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow */}
                <div role="listitem" className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2">
                  <span className="type-body text-label-primary">{t('receipt.allInto')}</span>
                  <PantrySelect
                    pantries={pantries}
                    value={pantryOfAll}
                    onChange={setAll}
                    label={t('receipt.allInto')}
                    placeholder={t('receipt.allInto.mixed')}
                  />
                </div>
              </ListSection>
            ) : null}

            {toIdentify.length > 0 ? (
              <ListSection
                header={t('receipt.toIdentify', { n: toIdentify.length })}
                footer={t('receipt.toIdentify.footer')}
              >
                {toIdentify.map((line) => (
                  <UnknownRow
                    key={line.key}
                    line={line}
                    onScan={() => setScanning(line.key)}
                    onIgnore={() => update(line.key, { included: false })}
                  />
                ))}
              </ListSection>
            ) : null}

            {recognized.length > 0 ? (
              <ListSection header={t('receipt.recognized', { n: recognized.length })}>
                {recognized.map((line) => (
                  <LineRow
                    key={line.key}
                    line={line}
                    name={productName(line.productId) ?? line.name}
                    pantries={pantries}
                    onChange={(patch) => update(line.key, patch)}
                  />
                ))}
              </ListSection>
            ) : null}

            {ignored.length > 0 ? (
              <ListSection header={t('receipt.ignored', { n: ignored.length })}>
                {ignored.map((line) => (
                  <IgnoredRow
                    key={line.key}
                    line={line}
                    name={productName(line.productId) ?? line.name}
                    onInclude={() => update(line.key, { included: true })}
                  />
                ))}
              </ListSection>
            ) : null}

            <div className="flex justify-center">
              <Button variant="plain" size="small" icon={Camera} onClick={onRetake}>
                {t('receipt.retake')}
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <LineBarcodeScanner lineName={scanLine?.name ?? null} onClose={() => setScanning(null)} onCode={onCode} />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('receipt.discard.title')}
        message={t('receipt.discard.message')}
        actions={[
          {
            label: t('receipt.discard'),
            destructive: true,
            onPress: () => {
              setConfirmDiscard(false);
              onClose();
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

function priceLine(line: ReviewLine): string {
  return line.unitPriceCents !== null
    ? t('receipt.lineMeta', { qty: line.quantity, price: formatPriceCents(line.unitPriceCents) })
    : t('receipt.lineMetaNoPrice', { qty: line.quantity });
}

function Row({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
    <div role="listitem" className="relative flex flex-col gap-2 px-4 py-3">
      {children}
      <RowSeparator inset={16} />
    </div>
  );
}

function Title({ name, label }: { name: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="line-clamp-2 type-body text-label-primary">{name}</p>
      <p className="truncate type-footnote text-label-tertiary">{label}</p>
    </div>
  );
}

function LineRow({
  line,
  name,
  pantries,
  onChange,
}: {
  line: ReviewLine;
  name: string;
  pantries: readonly Pantry[];
  onChange: (patch: Partial<ReviewLine>) => void;
}) {
  return (
    <Row>
      <div className="flex items-start justify-between gap-3">
        <Title name={name} label={line.label} />
        <span className="shrink-0 pt-0.5 font-rounded type-subhead tabular-nums text-label-secondary">
          {line.unitPriceCents !== null ? formatPriceCents(line.unitPriceCents) : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        {pantries.length >= 2 ? (
          <PantrySelect
            pantries={pantries}
            value={isWritable(line) ? line.pantryId : null}
            onChange={(pantryId) => onChange({ pantryId })}
            label={t('receipt.pantry', { name })}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          <Button variant="plain" size="small" onClick={() => onChange({ included: false })}>
            {t('receipt.ignore')}
          </Button>
          <QuantityStepper
            value={line.quantity}
            min={1}
            max={999}
            onChange={(quantity) => onChange({ quantity: Math.max(1, quantity) })}
            label={t('a11y.groceries.quantity')}
            decrementLabel={t('a11y.item.remove1')}
            incrementLabel={t('a11y.item.add1')}
            editLabel={t('a11y.groceries.editQuantity')}
          />
        </div>
      </div>
    </Row>
  );
}

function UnknownRow({ line, onScan, onIgnore }: { line: ReviewLine; onScan: () => void; onIgnore: () => void }) {
  return (
    <Row>
      <div className="flex items-start justify-between gap-3">
        <Title name={line.name} label={`${line.label} · ${priceLine(line)}`} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="plain" size="small" onClick={onIgnore}>
          {t('receipt.ignore')}
        </Button>
        <Button variant="secondary" size="small" icon={ScanBarcode} onClick={onScan}>
          {t('receipt.scanBarcode')}
        </Button>
      </div>
    </Row>
  );
}

function IgnoredRow({ line, name, onInclude }: { line: ReviewLine; name: string; onInclude: () => void }) {
  return (
    <Row>
      <div className="flex items-center justify-between gap-3">
        <div className="opacity-60">
          <Title name={name} label={`${line.label} · ${priceLine(line)}`} />
        </div>
        <Button variant="plain" size="small" onClick={onInclude}>
          {t('receipt.include')}
        </Button>
      </div>
    </Row>
  );
}
