import { Check, CircleAlert, CloudAlert, CloudDownload, CloudOff, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { closeSheet, pushItem, useOverlay } from '@/app/navigation';
import { attentionActions, syncNow } from '@/app/session';
import { useProductView } from '@/entities/product';
import { useAttentionGroups } from '@/entities/sync';
import { formatRelativeTime, t } from '@/shared/i18n';
import { Button, ListRow, ListSection, Sheet, SheetTextButton } from '@/shared/ui';
import { useSyncView } from './AppSyncIndicator';

type OutboxEntry = ReturnType<typeof useAttentionGroups>[number]['entry'];

/** «Synchronisation» (design 03 §2.4), `?sheet=sync`, detent `fit`. */
export function SyncSheet() {
  const overlay = useOverlay();
  const open = overlay.sheet === 'sync';
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && closeSheet()}
      title={t('sync.sheet.title')}
      trailing={
        <SheetTextButton emphasis onPress={closeSheet}>
          {t('common.done')}
        </SheetTextButton>
      }
      closeLabel={t('common.close')}
    >
      {open ? <SyncSheetContent /> : null}
    </Sheet>
  );
}

function SyncSheetContent() {
  const { summary, online, view } = useSyncView();
  const groups = useAttentionGroups();
  const [syncing, setSyncing] = useState(false);
  const offline = !online || summary.offline;

  let icon: LucideIcon = Check;
  let title = t('sync.sheet.status.synced');
  if (view.state === 'firstSync') {
    icon = CloudDownload;
    title = t('sync.sheet.status.firstSync');
  } else if (offline) {
    icon = CloudOff;
    title = t('sync.sheet.status.offline');
  } else if (view.state === 'error') {
    icon = CloudAlert;
    title = t('sync.sheet.status.error');
  }
  const Icon = icon;
  const last = summary.lastSyncedAt
    ? t('sync.sheet.lastSync', { time: formatRelativeTime(new Date(summary.lastSyncedAt)) })
    : t('sync.sheet.neverSynced');

  const runSync = () => {
    setSyncing(true);
    void syncNow().finally(() => setSyncing(false));
  };

  return (
    <div className="flex flex-col gap-6 pb-2">
      <ListSection label={t('sync.sheet.title')}>
        <ListRow
          variant="plain"
          leading={<Icon size={28} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
          title={title}
          subtitle={last}
        />
      </ListSection>

      {summary.pendingCount > 0 ? (
        <ListSection
          header={t('sync.sheet.pending.title')}
          footer={offline ? t('sync.sheet.pending.offlineFooter') : t('sync.sheet.pending.onlineFooter')}
        >
          <ListRow variant="plain" title={t('sync.indicator.pending', { n: summary.pendingCount })} />
        </ListSection>
      ) : null}

      {groups.length > 0 ? (
        <ListSection header={t('sync.sheet.attention.title')}>
          {groups.map((g) => (
            <AttentionRow key={g.entry.id} entry={g.entry} dependents={g.dependents.length} />
          ))}
        </ListSection>
      ) : null}

      {summary.clockSkewWarning ? (
        <p className="px-8 type-footnote text-label-secondary">{t('sync.sheet.clockSkew')}</p>
      ) : null}

      <div className="px-4">
        <Button fullWidth pill disabled={offline || syncing} loading={syncing} onClick={runSync}>
          {syncing ? t('sync.sheet.syncing') : t('sync.sheet.syncNow')}
        </Button>
      </div>
    </div>
  );
}

function productIdOf(entry: OutboxEntry): string | null {
  const args = entry.envelope.args as { productId?: unknown };
  return typeof args.productId === 'string' ? args.productId : null;
}

/** One «À vérifier» item (design 03 §2.5.7). The server result does not name the member, hence the generic titles. */
function AttentionRow({ entry, dependents }: { entry: OutboxEntry; dependents: number }) {
  const productId = productIdOf(entry);
  const product = useProductView(productId ?? '');
  const name = product?.product.name ?? '—';
  const reason = entry.attentionReason;
  const code = entry.result?.code;
  const isPantry = entry.envelope.name.startsWith('pantry.') || entry.envelope.name === 'stock.transfer';

  let title: string;
  let detail: string;
  let primary: { label: string; onPress: () => void } | null = null;
  if (reason === 'gone' && isPantry) {
    title = t('attention.pantryGone.titleUnknown');
    detail = t('attention.invalid.detail', { product: name });
  } else if (reason === 'gone') {
    title = t('attention.gone.titleUnknown');
    detail = t('attention.gone.detail', { product: name });
    primary = { label: t('attention.gone.restore'), onPress: () => void attentionActions.retry(entry.id) };
  } else if (code === 'name_taken') {
    title = t('attention.nameTaken.title');
    detail = t('attention.nameTaken.detail', { name });
  } else {
    title = t('attention.invalid.title');
    detail = t('attention.invalid.detail', { product: name });
  }
  if (!primary && productId && product) {
    primary = {
      label: t('attention.open'),
      onPress: () => {
        closeSheet();
        setTimeout(() => pushItem(productId), 0);
      },
    };
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: ListSection rows are div listitems (shared/ui convention)
    <div role="listitem" className="flex gap-3 px-4 py-3">
      <CircleAlert
        size={28}
        strokeWidth={1.5}
        absoluteStrokeWidth
        aria-hidden="true"
        className="shrink-0 text-warning-fg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="type-body text-label-primary">{title}</p>
        <p className="type-subhead text-label-secondary">{detail}</p>
        {dependents > 0 ? (
          <p className="type-subhead text-label-secondary">{t('attention.dependents', { n: dependents })}</p>
        ) : null}
        <div className="mt-1 flex gap-4">
          {primary ? (
            <button
              type="button"
              onClick={primary.onPress}
              className="min-h-11 type-body text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
            >
              {primary.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void attentionActions.discard(entry.id)}
            className="min-h-11 type-body text-label-secondary outline-none focus-visible:focus-ring active:opacity-60"
          >
            {t('attention.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
