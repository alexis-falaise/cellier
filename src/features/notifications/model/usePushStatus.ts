import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserId } from '@/domain/types';
import { browserPushEnvironment, type PushEnvironment } from './environment';
import {
  disablePush,
  type EnablePushResult,
  enablePush,
  type LocalPushStore,
  localStoragePushStore,
  type PreferencesResult,
  type PushClient,
  type PushDeps,
  type PushPreferences,
  type PushStatus,
  readPushPreferences,
  readPushStatus,
  updatePushPreferences,
} from './push';

export interface UsePushStatusOptions {
  /** `supabase as unknown as PushClient`. */
  client: PushClient;
  /** Signed-in user; enabling is refused without one. */
  userId: UserId | null;
  env?: PushEnvironment;
  store?: LocalPushStore;
  /** Defaults to `import.meta.env.VITE_VAPID_PUBLIC_KEY`. */
  vapidPublicKey?: string;
}

export interface PushStatusController {
  status: PushStatus;
  /** An enable, disable or switch change is in progress. */
  busy: boolean;
  /** Call straight from the button's onClick (no await before it): it asks for permission first. */
  enable(): Promise<EnablePushResult>;
  /** Stops push on this device (row deleted, subscription removed). */
  disable(): Promise<void>;
  /** Per-device switches; online only. On success the status carries the new values. */
  setPreferences(change: Partial<PushPreferences>): Promise<PreferencesResult>;
  /** Re-reads permission, subscription and switches (also done when the app becomes visible). */
  refresh(): Promise<void>;
}

const BUILD_VAPID_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** State and actions for Réglages › Notifications and the Accueil prompt card (04 §1.2–§1.3, §1.10). */
export function usePushStatus(options: UsePushStatusOptions): PushStatusController {
  const [env] = useState(() => options.env ?? browserPushEnvironment());
  const [store] = useState(() => options.store ?? localStoragePushStore());
  const [status, setStatus] = useState<PushStatus>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  const latest = useRef(options);
  latest.current = options;
  const deps = (): PushDeps => ({
    env,
    store,
    client: latest.current.client,
    vapidPublicKey: latest.current.vapidPublicKey ?? BUILD_VAPID_KEY,
  });

  const refresh = useCallback(async () => {
    const next = await readPushStatus(env);
    if (next.kind !== 'subscribed') {
      setStatus(next);
      return;
    }
    const prefs = await readPushPreferences(latest.current.client, next.endpoint);
    setStatus({ ...next, prefs: prefs.ok ? prefs.prefs : null });
  }, [env]);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const enable = (): Promise<EnablePushResult> => {
    const userId = latest.current.userId;
    if (!userId) return Promise.resolve({ ok: false, reason: 'error' });
    setBusy(true);
    return enablePush(deps(), userId).finally(() => {
      setBusy(false);
      void refresh();
    });
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disablePush(deps());
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const setPreferences = async (change: Partial<PushPreferences>): Promise<PreferencesResult> => {
    if (status.kind !== 'subscribed') return { ok: false, reason: 'not-found' };
    setBusy(true);
    try {
      const result = await updatePushPreferences(latest.current.client, status.endpoint, change);
      if (result.ok) setStatus({ ...status, prefs: result.prefs });
      return result;
    } finally {
      setBusy(false);
    }
  };

  return { status, busy, enable, disable, setPreferences, refresh };
}
