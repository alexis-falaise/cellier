import { Bell, House, Info, RefreshCw, Shapes, SquarePlus, Vibrate, Warehouse } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { closeSheet, openSheet, pushSheetPage } from '@/app/navigation';
import { useActiveHousehold, useSession } from '@/app/session';
import { useCategories } from '@/entities/category';
import { useMembers } from '@/entities/member';
import { usePantries } from '@/entities/pantry';
import { useSyncSummary } from '@/entities/sync';
import { useOnline } from '@/features/auth';
import { browserPushEnvironment, type PushStatus, readPushStatus } from '@/features/notifications';
import { t } from '@/shared/i18n';
import { hapticSupport, isHapticsEnabled, setHapticsEnabled } from '@/shared/lib/haptics';
import { isStandalone, ListRow, ListSection, SheetTextButton, Switch } from '@/shared/ui';
import { notificationsSummary } from '../model/account';
import { APP_BUILD, APP_VERSION } from '../model/version';
import { Avatar, PageLayout, RowIcon } from './common';

const VAPID_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** Permission and subscription of this device, without network (value of the «Notifications» row). */
function usePushKind(): PushStatus['kind'] {
  const [kind, setKind] = useState<PushStatus['kind']>('loading');
  useEffect(() => {
    let alive = true;
    const env = browserPushEnvironment();
    const read = () =>
      void readPushStatus(env)
        .then((s) => alive && setKind(s.kind))
        .catch(() => alive && setKind('unsupported'));
    read();
    const onVisible = () => document.visibilityState === 'visible' && read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return kind;
}

function useSyncLabel(): string {
  const summary = useSyncSummary();
  const online = useOnline();
  if (summary.firstSync) return t('sync.sheet.status.firstSync');
  if (!online || summary.offline) return t('sync.sheet.status.offline');
  if (summary.status.kind === 'error') return t('sync.sheet.status.error');
  if (summary.pendingCount > 0) return t('sync.indicator.pending', { n: summary.pendingCount });
  return t('sync.sheet.status.synced');
}

/** Réglages root (03 §4.10): account, household, preferences, sync, about. */
export function RootPage() {
  const { user } = useSession();
  const household = useActiveHousehold();
  const members = useMembers();
  const pantries = usePantries();
  const categories = useCategories();
  const pushKind = usePushKind();
  const syncLabel = useSyncLabel();
  const [haptics, setHaptics] = useState(isHapticsEnabled);
  const hapticsId = useId();
  const showHaptics = hapticSupport() !== 'none';
  const name = user?.name ?? user?.email ?? t('settings.title');
  const notifications = notificationsSummary(pushKind, VAPID_KEY);

  return (
    <PageLayout
      page="root"
      trailing={
        <SheetTextButton emphasis onPress={closeSheet}>
          {t('common.done')}
        </SheetTextButton>
      }
    >
      <ListSection label={t('account.provider')}>
        <ListRow
          className="min-h-[76px]"
          leading={<Avatar src={user?.avatarUrl} name={user?.name ?? user?.email ?? null} size={56} />}
          leadingWidth={56}
          title={<span className="type-headline">{name}</span>}
          subtitle={user?.email && user.email !== name ? user.email : undefined}
          onPress={() => pushSheetPage({ page: 'account' })}
        />
      </ListSection>

      <ListSection header={t('settings.section.household')}>
        <ListRow
          leading={<RowIcon icon={House} />}
          title={household.name ?? t('household.title')}
          value={members.length > 0 ? t('settings.membersCount', { n: members.length }) : undefined}
          onPress={() => pushSheetPage({ page: 'household' })}
        />
        <ListRow
          leading={<RowIcon icon={Warehouse} />}
          title={t('pantries.title')}
          value={pantries.length > 0 ? String(pantries.length) : undefined}
          onPress={() => pushSheetPage({ page: 'pantries' })}
        />
        <ListRow
          leading={<RowIcon icon={Shapes} />}
          title={t('categories.title')}
          value={categories.length > 0 ? String(categories.length) : undefined}
          onPress={() => pushSheetPage({ page: 'categories' })}
        />
      </ListSection>

      <ListSection header={t('settings.section.prefs')} footer={showHaptics ? t('settings.haptics.footer') : undefined}>
        <ListRow
          leading={<RowIcon icon={Bell} />}
          title={t('notifications.title')}
          value={pushKind === 'loading' ? undefined : t(`settings.notifications.${notifications}`)}
          onPress={() => pushSheetPage({ page: 'notifications' })}
        />
        {showHaptics ? (
          <ListRow
            variant="toggle"
            leading={<RowIcon icon={Vibrate} />}
            title={<span id={hapticsId}>{t('settings.haptics')}</span>}
            trailing={
              <Switch
                checked={haptics}
                labelledBy={hapticsId}
                onCheckedChange={(on) => {
                  setHapticsEnabled(on);
                  setHaptics(on);
                }}
              />
            }
          />
        ) : null}
      </ListSection>

      <ListSection label={t('sync.sheet.title')}>
        <ListRow
          leading={<RowIcon icon={RefreshCw} />}
          title={t('sync.sheet.title')}
          value={syncLabel}
          onPress={() => openSheet({ sheet: 'sync' })}
        />
      </ListSection>

      {isStandalone() ? null : (
        <ListSection label={t('home.installRow')}>
          <ListRow
            variant="button"
            leading={<RowIcon icon={SquarePlus} tone="accent" />}
            title={t('home.installRow')}
            onPress={() => openSheet({ sheet: 'install' })}
          />
        </ListSection>
      )}

      <ListSection header={t('settings.section.about')}>
        <ListRow
          leading={<RowIcon icon={Info} />}
          title={t('about.sources')}
          onPress={() => pushSheetPage({ page: 'about' })}
        />
      </ListSection>

      <p className="px-4 text-center type-footnote text-label-secondary">
        {t('settings.version', { version: APP_VERSION, build: APP_BUILD })}
      </p>
    </PageLayout>
  );
}
