import { useCallback, useEffect, useState } from 'react';
import { closeConfirm, closeSheet, type GlobalSearch, openConfirm, useOverlay } from '@/app/navigation';
import { useActivePantry } from '@/app/session';
import { useProductView } from '@/entities/product';
import { t } from '@/shared/i18n';
import { ConfirmDialog, Sheet } from '@/shared/ui';
import { ItemEditSheet } from './ItemEditSheet';
import { MoveSheet } from './MoveSheet';
import { NewItemSheet } from './NewItemSheet';
import { RecountSheet } from './RecountSheet';

const DISCARD = 'discard';

type SheetKind = 'item-edit' | 'recount' | 'item-move' | 'new-item';

interface Route {
  sheet: SheetKind;
  id: string;
  step: 'category' | undefined;
  pantry: string | undefined;
  /** Bumped each time a sheet opens, so a reopened form starts fresh. */
  n: number;
}

let opened = 0;

function routeOf(o: GlobalSearch): Omit<Route, 'n'> | null {
  if (o.sheet === 'new-item') return { sheet: 'new-item', id: '', step: o.step, pantry: undefined };
  if ((o.sheet === 'item-edit' || o.sheet === 'recount' || o.sheet === 'item-move') && o.id) {
    return { sheet: o.sheet, id: o.id, step: o.step, pantry: o.pantry };
  }
  return null;
}

/**
 * Mounted once by the tab shell: ItemEditSheet (`?sheet=item-edit&id=…[&step=category]`),
 * RecountSheet (`?sheet=recount&id=…&pantry=…`), MoveSheet (`?sheet=item-move&id=…`) and
 * NewItemSheet (`?sheet=new-item[&step=category]`). The last route stays mounted while its sheet
 * slides away.
 */
export function ItemEditSheetHost() {
  const overlay = useOverlay();
  const current = routeOf(overlay);
  const [route, setRoute] = useState<Route | null>(null);
  if (current && (route === null || route.sheet !== current.sheet || route.id !== current.id)) {
    opened += 1;
    setRoute({ ...current, n: opened });
  } else if (current && route && (route.step !== current.step || route.pantry !== current.pantry)) {
    setRoute({ ...route, step: current.step, pantry: current.pantry });
  }
  const open = current !== null && route !== null && current.sheet === route.sheet && current.id === route.id;
  const exited = useCallback(() => setRoute(null), []);
  if (!route) return null;

  if (route.sheet === 'item-edit' || route.sheet === 'new-item') {
    return (
      <FormSheetHost
        key={`${route.sheet}:${route.n}`}
        route={route}
        open={open}
        confirm={overlay.confirm}
        onExited={exited}
      />
    );
  }
  return <StockSheet key={`${route.sheet}:${route.n}`} route={route} open={open} onExited={exited} />;
}

/** Closes the open sheet when the product it is about is gone (deleted elsewhere, unknown id). */
function useCloseWhenMissing(open: boolean, missing: boolean) {
  useEffect(() => {
    if (open && missing) closeSheet();
  }, [open, missing]);
}

function FormSheetHost({
  route,
  open,
  confirm,
  onExited,
}: {
  route: Route;
  open: boolean;
  confirm: string | undefined;
  onExited: () => void;
}) {
  const view = useProductView(route.id);
  const [dirty, setDirty] = useState(false);
  const requestDiscard = useCallback(() => openConfirm(DISCARD), []);
  const editing = route.sheet === 'item-edit';
  useCloseWhenMissing(open, editing && (!view || view.product.deletedAt !== null));

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) closeSheet();
        }}
        detents={['large']}
        dirty={dirty}
        onDismissBlocked={requestDiscard}
        closeLabel={t('common.close')}
        onExited={onExited}
      >
        {editing ? (
          view ? (
            <ItemEditSheet
              product={view.product}
              step={route.step}
              onDirtyChange={setDirty}
              onDiscardRequest={requestDiscard}
            />
          ) : null
        ) : (
          <NewItemSheet step={route.step} onDirtyChange={setDirty} onDiscardRequest={requestDiscard} />
        )}
      </Sheet>
      <ConfirmDialog
        open={open && confirm === DISCARD}
        onOpenChange={(next) => {
          if (!next) closeConfirm();
        }}
        title={t('common.discard.title')}
        actions={[{ label: t('common.discard.confirm'), destructive: true, onPress: closeSheet }]}
        cancelLabel={t('common.discard.cancel')}
      />
    </>
  );
}

function StockSheet({ route, open, onExited }: { route: Route; open: boolean; onExited: () => void }) {
  const view = useProductView(route.id);
  const { pantries, pantry: current } = useActivePantry();
  const missing = !view || view.product.deletedAt !== null;
  useCloseWhenMissing(open, missing);
  if (!view) return null;
  if (route.sheet === 'item-move') {
    return <MoveSheet open={open && !missing} view={view} pantries={pantries} onExited={onExited} />;
  }
  const pantryId =
    route.pantry ?? view.perPantry[0]?.pantryId ?? (current?.id as string | undefined) ?? pantries[0]?.id ?? null;
  if (!pantryId) return null;
  const pantry = pantries.find((p) => p.id === pantryId);
  return (
    <RecountSheet
      open={open && !missing}
      productId={view.product.id}
      pantryId={pantryId}
      pantryName={pantry?.name ?? ''}
      current={view.perPantry.find((r) => r.pantryId === pantryId)?.quantity ?? 0}
      onExited={onExited}
    />
  );
}
