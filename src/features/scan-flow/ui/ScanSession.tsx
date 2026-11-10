import { Flashlight, FlashlightOff, Keyboard, X } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { closeScanner } from '@/app/navigation';
import { useActiveHousehold, useActivePantry } from '@/app/session';
import { showToast } from '@/app/toasts';
import type { Gtin, PantryId } from '@/domain/types';
import {
  isCameraPrimed,
  markCameraPrimed,
  type ScannedCode,
  type ScannerState,
  ScannerViewport,
  type ScannerViewportHandle,
} from '@/features/scanner';
import { t } from '@/shared/i18n';
import { haptic } from '@/shared/lib/haptics';
import { presets } from '@/shared/lib/motion';
import { getSyncStore, useStore } from '@/shared/sync';
import { cx, IconButton, Reticle, type ReticleTone, readSafeArea, SegmentedControl } from '@/shared/ui';
import { lookupHousehold } from '../model/local';
import { rowKey, type ScanMode } from '../model/tray';
import { type CommitResult, undoCommit, useScanFlow } from '../model/useScanFlow';
import { CameraPrimer, CameraProblem, DarkTextButton } from './CameraStates';
import { ManualEntrySheet } from './ManualEntrySheet';
import { ScannerTray, TRAY_COMPACT, TRAY_EMPTY } from './ScannerTray';
import { CloseConfirmPanel, PantryPickerPanel } from './TrayPanels';
import { UnknownProductSheet } from './UnknownProductSheet';

type Panel = { kind: 'unknown'; rowId: string } | { kind: 'manual' } | { kind: 'pantry' } | { kind: 'close' };

const SUCCESS_TONE_MS = 600;
const BANNER_MS = 4000;
const START_FALLBACK_MS = 700;

export interface ScanSessionProps {
  /** `mode` of the URL, read once when the cover opens (03 §1.3). */
  initialMode: ScanMode;
  /** The cover's Escape / close request goes through the session (it asks first when the tray has rows). */
  onRegisterClose: (close: () => void) => void;
}

/** Everything inside ScannerCover (03 §4.4): camera, reticle, top bar, hints, tray and the local overlays. */
export function ScanSession({ initialMode, onRegisterClose }: ScanSessionProps) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const household = useActiveHousehold();
  const active = useActivePantry();
  const [chosenPantry, setChosenPantry] = useState<PantryId | null>(null);
  const livePantry = active.pantries.find((p) => p.id === chosenPantry) ?? null;
  const pantryId = livePantry?.id ?? active.pantry?.id ?? active.pantries[0]?.id ?? null;
  const flow = useScanFlow({ mode, pantryId, householdId: household.id });
  const rows = flow.state.rows;

  const viewport = useRef<ScannerViewportHandle>(null);
  const [camera, setCamera] = useState<ScannerState | null>(null);
  const [primed, setPrimed] = useState(isCameraPrimed);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tone, setTone] = useState<ReticleTone>('idle');
  const [successes, setSuccesses] = useState(0);
  const [announce, setAnnounce] = useState('');
  const toneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef(false);

  const status = camera?.status ?? 'idle';
  const problem = status === 'error' ? camera?.error : null;

  // The camera granted from the primer: the primer never shows again on this device.
  useEffect(() => {
    if (status === 'live' && !primed) {
      markCameraPrimed();
      setPrimed(true);
    }
  }, [status, primed]);

  // Long press (withdraw): the cover opened from a timer; the finger lift is the activation (02 §3.5). The shell
  // primes the camera on that lift; start() adopts it once the handler has run.
  useEffect(() => {
    if (initialMode !== 'withdraw' || !isCameraPrimed()) return;
    const onUp = () => setTimeout(() => void viewport.current?.start(), 0);
    window.addEventListener('pointerup', onUp, { once: true, capture: true });
    return () => window.removeEventListener('pointerup', onUp, { capture: true });
  }, [initialMode]);

  // «Démarrer la caméra» when the camera did not start by itself.
  const [showStart, setShowStart] = useState(false);
  useEffect(() => {
    if (!primed || status !== 'idle') {
      setShowStart(false);
      return;
    }
    const timer = setTimeout(() => setShowStart(true), START_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [primed, status]);

  useEffect(() => () => clearTimeout(toneTimer.current), []);

  // --- Detection --------------------------------------------------------------------------------
  const rowsRef = useRef(rows);
  const modeRef = useRef(mode);
  useLayoutEffect(() => {
    rowsRef.current = rows;
    modeRef.current = mode;
  });

  const onDetect = (code: ScannedCode) => {
    if (closing.current) return;
    const key = rowKey(code);
    const previous = rowsRef.current.find((r) => r.key === key);
    // Same task as the worker message: the row exists before the next frame (02 §4.3).
    flushSync(() => flow.detect(code));
    if (code.kind === 'variable-measure') {
      // In-store code: no lookup, straight to manual entry; neutral reticle and no haptic (02 §6).
      if (!previous) {
        const row = rowsRef.current.find((r) => r.key === key);
        if (row) setPanel({ kind: 'unknown', rowId: row.id });
      }
      return;
    }
    haptic('scan');
    setSuccesses((n) => n + 1);
    setTone('success');
    clearTimeout(toneTimer.current);
    toneTimer.current = setTimeout(() => setTone('idle'), SUCCESS_TONE_MS);
    const snapshot = getSyncStore().getSnapshot();
    const hit = lookupHousehold(snapshot, code.gtin14 as Gtin);
    const name = (hit && snapshot.rows.product.get(hit.productId)?.name) ?? code.digits;
    const n = (previous?.quantity ?? 0) + 1;
    setAnnounce(
      modeRef.current === 'add'
        ? t('a11y.scanner.added', { product: name, n })
        : t('a11y.scanner.withdrawn', { product: name, n }),
    );
  };

  // --- Close and commit -------------------------------------------------------------------------
  const close = () => {
    closing.current = true;
    viewport.current?.stop();
    closeScanner();
  };

  const requestClose = () => {
    if (panel && panel.kind !== 'close') {
      setPanel(null);
      return;
    }
    if (rows.length > 0) setPanel({ kind: 'close' });
    else close();
  };
  useEffect(() => {
    onRegisterClose(requestClose);
  });

  const pantryName = (id: PantryId | null): string =>
    (id ? active.pantries.find((p) => p.id === id)?.name : undefined) ?? active.pantry?.name ?? '';

  const finish = () => {
    if (closing.current) return;
    const result = flow.commit();
    close();
    toastFor(result, mode, pantryName);
  };

  // --- Banners: restored draft, removed row with «Annuler» -------------------------------------
  const [bannerRestored, setBannerRestored] = useState(0);
  const { restoredCount, clearRestored } = flow;
  useEffect(() => {
    if (restoredCount === 0) return;
    setBannerRestored(restoredCount);
    clearRestored();
  }, [restoredCount, clearRestored]);
  useEffect(() => {
    if (bannerRestored === 0) return;
    const timer = setTimeout(() => setBannerRestored(0), BANNER_MS);
    return () => clearTimeout(timer);
  }, [bannerRestored]);

  const removed = flow.state.removed;
  const [removedShown, setRemovedShown] = useState<string | null>(null);
  useEffect(() => {
    if (!removed) {
      setRemovedShown(null);
      return;
    }
    setRemovedShown(removed.row.id);
    const timer = setTimeout(() => setRemovedShown(null), BANNER_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  const removedName = useStore((s) => {
    const st = removed?.row.status;
    if (!st) return '';
    if (st.kind === 'household') return s.rows.product.get(st.productId)?.name ?? '';
    if (st.kind === 'catalogue') return st.product.name;
    if (st.kind === 'named') return st.input.name;
    return '';
  });

  const bannerTransition = reduced ? presets.reduced : presets.smooth;
  const banner = (
    <AnimatePresence initial={false}>
      {removed && removedShown === removed.row.id ? (
        <m.div
          key="removed"
          className="flex h-8 items-center gap-3 px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: bannerTransition }}
          exit={{ opacity: 0, transition: bannerTransition }}
        >
          <p className="min-w-0 flex-1 truncate type-footnote text-stone-0/70">
            {t('scanner.row.removed', { product: removedName || removed.row.digits || t('scanner.row.unknown') })}
          </p>
          <button
            type="button"
            onClick={flow.undoRemove}
            className="relative type-footnote font-semibold text-green-300 outline-none before:absolute before:-inset-3 focus-visible:focus-ring active:opacity-60"
          >
            {t('common.undo')}
          </button>
        </m.div>
      ) : bannerRestored > 0 ? (
        <m.p
          key="restored"
          className="flex h-8 items-center px-4 type-footnote text-stone-0/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: bannerTransition }}
          exit={{ opacity: 0, transition: bannerTransition }}
        >
          {t('scanner.restored', { n: bannerRestored })}
        </m.p>
      ) : null}
    </AnimatePresence>
  );
  const bannerVisible = (removed !== null && removedShown === removed.row.id) || bannerRestored > 0;

  // --- Geometry ---------------------------------------------------------------------------------
  const [viewportH, setViewportH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const [safeBottom] = useState(() => readSafeArea().bottom);
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const trayHeight = Math.round(viewportH * 0.6);
  const trayVisible = Math.min(
    trayHeight,
    (rows.length > 0 ? TRAY_COMPACT : TRAY_EMPTY) + safeBottom + (bannerVisible ? 32 : 0),
  );
  const trayTop = expanded ? trayHeight : trayVisible;

  // Units per cellier, for the pantry picker.
  const stock = useStore((s) => s.rows.stock);
  const unitsIn = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of stock.values()) totals.set(row.pantryId, (totals.get(row.pantryId) ?? 0) + row.quantity);
    return (id: PantryId) => totals.get(id) ?? 0;
  }, [stock]);

  const panelRow = panel?.kind === 'unknown' ? rows.find((r) => r.id === panel.rowId) : undefined;
  const showProblem = problem != null;
  const showPrimer = !primed && !showProblem && status !== 'starting' && status !== 'live';
  const hint = mode === 'add' ? t('scanner.hint.add') : t('scanner.hint.withdraw');
  const torch = camera?.torch ?? { supported: false, on: false };
  const fade = reduced ? presets.reduced : presets.smooth;

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0" inert={panel !== null || undefined}>
        <ScannerViewport
          ref={viewport}
          className="absolute inset-0"
          onDetect={onDetect}
          onStateChange={setCamera}
          paused={panel !== null}
        >
          {({ rect }) => (
            <>
              {/* Dim mask: black 45 % around the reticle cut-out. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[20px]"
                style={{ boxShadow: '0 0 0 200vmax rgb(0 0 0 / 0.45)' }}
              />
              <m.div
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: status === 'live' ? 1 : 0.4, transition: fade }}
              >
                <Reticle successCount={successes} tone={tone} width={rect.width} height={rect.height} />
              </m.div>
              <div className="pointer-events-none absolute inset-x-0 top-full mt-4 flex justify-center px-2">
                {camera?.lowLight ? (
                  <button
                    type="button"
                    disabled={!torch.supported || torch.on}
                    onClick={() => void viewport.current?.setTorch(true)}
                    className="pointer-events-auto flex h-9 items-center rounded-full bg-scanner-material px-4 type-footnote text-stone-0 backdrop-blur-xl outline-none focus-visible:focus-ring"
                  >
                    {torch.supported ? t('scanner.lowLight.torch') : t('scanner.lowLight.noTorch')}
                  </button>
                ) : (
                  <m.p
                    className="text-center type-footnote text-stone-0/70"
                    initial={false}
                    animate={{ opacity: flow.state.recognitions > 0 ? 0 : 1, transition: fade }}
                  >
                    {hint}
                  </m.p>
                )}
              </div>
            </>
          )}
        </ScannerViewport>

        {showPrimer ? (
          <CameraPrimer onAllow={() => void viewport.current?.start()} onManual={() => setPanel({ kind: 'manual' })} />
        ) : null}
        {showProblem ? (
          <CameraProblem
            denied={problem?.code === 'permission-denied'}
            onRetry={() => void viewport.current?.start()}
            onManual={() => setPanel({ kind: 'manual' })}
          />
        ) : null}
        {showStart && !showPrimer && !showProblem ? (
          <div className="absolute inset-x-0 top-[44%] flex justify-center">
            <DarkTextButton onClick={() => void viewport.current?.start()}>{t('scanner.start')}</DarkTextButton>
          </div>
        ) : null}

        {/* Top bar: close, mode, torch. */}
        <div className="absolute inset-x-0 top-[calc(var(--safe-top)+8px)] z-20 grid grid-cols-[1fr_auto_1fr] items-center px-2">
          <div className="flex justify-start">
            <IconButton
              icon={X}
              label={t('a11y.scanner.close')}
              tone="on-dark"
              className="bg-scanner-material backdrop-blur-xl"
              onClick={requestClose}
            />
          </div>
          <SegmentedControl
            label={t('scanner.modeLabel')}
            variant="scanner"
            className="w-[220px]"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'add', label: t('scanner.mode.add') },
              { value: 'withdraw', label: t('scanner.mode.withdraw') },
            ]}
          />
          <div className="flex justify-end">
            {torch.supported && !showProblem ? (
              <IconButton
                icon={torch.on ? FlashlightOff : Flashlight}
                label={torch.on ? t('a11y.scanner.torchOff') : t('a11y.scanner.torchOn')}
                tone="on-dark"
                className={cx('backdrop-blur-xl', torch.on ? 'bg-stone-0/30' : 'bg-scanner-material')}
                aria-pressed={torch.on}
                onClick={() => void viewport.current?.setTorch(!torch.on)}
              />
            ) : null}
          </div>
        </div>

        {/* Manual entry, 16 px above the tray. */}
        {!showPrimer && !showProblem ? (
          <div className="absolute left-4 z-10" style={{ bottom: trayTop + 16 }}>
            <IconButton
              icon={Keyboard}
              label={t('scanner.manual')}
              tone="on-dark"
              className="bg-scanner-material backdrop-blur-xl"
              onClick={() => setPanel({ kind: 'manual' })}
            />
          </div>
        ) : null}

        <ScannerTray
          rows={rows}
          ctx={flow.ctx}
          mode={mode}
          units={flow.units}
          categories={flow.categories}
          pantryName={pantryName}
          showPantryChip={active.pantries.length >= 2}
          onPantryChip={() => setPanel({ kind: 'pantry' })}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((e) => !e)}
          height={trayHeight}
          visible={trayVisible}
          doneDisabled={flow.units === 0}
          onDone={finish}
          banner={banner}
          onQuantity={flow.setQuantity}
          onRemove={flow.remove}
          onName={(rowId) => setPanel({ kind: 'unknown', rowId })}
          onPick={(rowId) => setPanel({ kind: 'unknown', rowId })}
          onTakeFrom={flow.setSource}
        />

        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
      </div>

      <UnknownProductSheet
        open={panel?.kind === 'unknown' && panelRow !== undefined}
        digits={panelRow?.digits || null}
        offerExisting={panelRow?.status.kind === 'store-code'}
        initial={panelRow?.status.kind === 'named' ? panelRow.status.input : null}
        onClose={() => setPanel(null)}
        onCreate={(input) => {
          if (panelRow) flow.name(panelRow.id, input);
          setPanel(null);
        }}
        onPick={(productId) => {
          if (panelRow) flow.pick(productId, panelRow.id);
          setPanel(null);
        }}
      />
      <ManualEntrySheet
        open={panel?.kind === 'manual'}
        onClose={() => setPanel(null)}
        onCode={(code) => {
          setPanel(null);
          onDetect(code);
        }}
        onPick={(productId) => {
          setPanel(null);
          flow.pick(productId);
          haptic('scan');
        }}
      />
      <PantryPickerPanel
        open={panel?.kind === 'pantry'}
        mode={mode}
        pantries={active.pantries}
        current={pantryId}
        unitsIn={unitsIn}
        onClose={() => setPanel(null)}
        onSelect={(id) => {
          setChosenPantry(id);
          setPanel(null);
        }}
      />
      <CloseConfirmPanel
        open={panel?.kind === 'close'}
        count={flow.units}
        onSave={() => {
          setPanel(null);
          finish();
        }}
        onDiscard={() => {
          setPanel(null);
          flow.discard();
          close();
        }}
        onContinue={() => setPanel(null)}
      />
    </div>
  );
}

/** Toast on the screen beneath once the cover has closed (03 §4.4.7); the queue holds it while the cover is open. */
function toastFor(result: CommitResult, mode: ScanMode, pantryName: (id: PantryId | null) => string): void {
  if (result.units === 0 && result.skipped === 0) return;
  const pantries = result.pantryIds;
  let message: string;
  if (result.units === 0) {
    message = t('toast.scan.skipped', { k: result.skipped }).replace(/^·\s*/, '');
  } else if (mode === 'add') {
    message = t('toast.scan.added', { n: result.units, pantry: pantryName(pantries[0] ?? null) });
  } else if (pantries.length === 1) {
    message = t('toast.scan.withdrawn', { n: result.units, pantry: pantryName(pantries[0] ?? null) });
  } else {
    message = t('toast.scan.withdrawnMulti', { n: result.units });
  }
  if (result.units > 0 && result.skipped > 0) message = `${message} ${t('toast.scan.skipped', { k: result.skipped })}`;
  const ids = result.movementIds;
  showToast({
    key: 'scan-commit',
    message,
    action:
      ids.length > 0
        ? {
            label: t('common.undo'),
            onPress: () => {
              void undoCommit(ids).then(() => showToast({ key: 'scan-commit', message: t('toast.undone') }));
            },
          }
        : undefined,
  });
}
