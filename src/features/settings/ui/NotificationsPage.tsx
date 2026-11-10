import { Bell, BellOff, CircleAlert, CloudOff, Smartphone } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { openSheet } from '@/app/navigation';
import { useSession } from '@/app/session';
import { showToast } from '@/app/toasts';
import { useOnline } from '@/features/auth';
import { type PushClient, type PushPreferences, usePushStatus } from '@/features/notifications';
import { t } from '@/shared/i18n';
import { Button, DelayedSpinner, ListRow, ListSection, StatusBanner, Switch } from '@/shared/ui';
import { PageLayout } from './common';

const VAPID_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY;

type ClientState = { kind: 'loading' } | { kind: 'ready'; client: PushClient } | { kind: 'unavailable' };

/** The Supabase client, loaded lazily (its module throws without its env vars). */
function usePushClient(): ClientState {
  const [state, setState] = useState<ClientState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    import('@/shared/api/supabase')
      .then(({ supabase }) => alive && setState({ kind: 'ready', client: supabase as unknown as PushClient }))
      .catch(() => alive && setState({ kind: 'unavailable' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Notifications (03 §4.14.1, 04-notifications §1.2): every push state of this device, and its two switches. */
export function NotificationsPage() {
  const client = usePushClient();
  return (
    <PageLayout page="notifications">
      {client.kind === 'ready' && VAPID_KEY ? (
        <PushSettings client={client.client} />
      ) : client.kind === 'loading' ? null : (
        <StatusBanner icon={BellOff} text={t('notifications.unavailable')} />
      )}
    </PageLayout>
  );
}

function Intro() {
  return <p className="px-8 type-body text-label-secondary text-pretty">{t('notifications.intro')}</p>;
}

function PushSettings({ client }: { client: PushClient }) {
  const { user } = useSession();
  const online = useOnline();
  const push = usePushStatus({ client, userId: user?.id ?? null });
  const alertsId = useId();
  const digestId = useId();
  const { status, busy } = push;

  // Called straight from the tap: `enable` asks for permission before anything is awaited.
  const enable = () => {
    void push.enable().then((result) => {
      if (result.ok) showToast({ message: t('toast.notifyOn'), icon: Bell, key: 'notify' });
      else if (result.reason === 'denied') showToast({ message: t('toast.notifyDenied'), key: 'notify' });
      else if (result.reason === 'not-installed') openSheet({ sheet: 'install' });
      else if (result.reason !== 'dismissed')
        showToast({ message: t('notifications.enableFailed'), icon: CircleAlert, key: 'notify' });
    });
  };

  const change = (patch: Partial<PushPreferences>) => {
    void push.setPreferences(patch).then((result) => {
      if (!result.ok) showToast({ message: t('notifications.saveFailed'), icon: CircleAlert, key: 'notify' });
    });
  };

  switch (status.kind) {
    case 'loading':
      return (
        <div className="flex justify-center pt-12">
          <DelayedSpinner active label={t('notifications.title')} />
        </div>
      );
    case 'unsupported':
      return <StatusBanner icon={BellOff} text={t('notifications.unsupported')} />;
    case 'needs-install':
      return (
        <StatusBanner
          icon={Smartphone}
          text={t('notifications.notInstalled')}
          action={{ label: t('notifications.howToInstall'), onPress: () => openSheet({ sheet: 'install' }) }}
        />
      );
    case 'denied':
      return (
        <StatusBanner
          icon={BellOff}
          text={
            <>
              <span className="block type-headline">{t('notifications.denied.title')}</span>
              <span className="block">{t('notifications.denied.body')}</span>
            </>
          }
        />
      );
    case 'default':
    case 'interrupted':
      return (
        <>
          {status.kind === 'interrupted' ? (
            <StatusBanner icon={CircleAlert} text={t('notifications.interrupted')} />
          ) : null}
          <Intro />
          <div className="flex flex-col gap-2 px-4">
            <Button fullWidth onClick={enable} loading={busy} disabled={!online || busy}>
              {status.kind === 'interrupted' ? t('notifications.reenable') : t('notifications.enable')}
            </Button>
            {online ? null : <p className="px-4 type-footnote text-label-secondary">{t('notifications.offline')}</p>}
          </div>
        </>
      );
    case 'subscribed': {
      const prefs = status.prefs;
      const disabled = !online || busy || prefs === null;
      return (
        <>
          {online ? null : <StatusBanner icon={CloudOff} text={t('notifications.offline')} />}
          <ListSection label={t('notifications.alerts')} footer={t('notifications.alerts.footer')}>
            <ListRow
              variant="toggle"
              title={<span id={alertsId}>{t('notifications.alerts')}</span>}
              trailing={
                <Switch
                  checked={prefs?.notifyRunningLow ?? true}
                  disabled={disabled}
                  labelledBy={alertsId}
                  onCheckedChange={(on) => change({ notifyRunningLow: on })}
                />
              }
            />
          </ListSection>
          <ListSection label={t('notifications.digest')} footer={t('notifications.digest.footer')}>
            <ListRow
              variant="toggle"
              title={<span id={digestId}>{t('notifications.digest')}</span>}
              trailing={
                <Switch
                  checked={prefs?.notifyDigest ?? true}
                  disabled={disabled}
                  labelledBy={digestId}
                  onCheckedChange={(on) => change({ notifyDigest: on })}
                />
              }
            />
          </ListSection>
          <p className="-mt-4 px-8 type-footnote text-label-secondary">{t('notifications.deviceFooter')}</p>
        </>
      );
    }
  }
}
