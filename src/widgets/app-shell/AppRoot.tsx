import { Outlet, useRouterState } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import { useEffect, useRef } from 'react';
import { hasUnsavedChanges, navigateTo } from '@/app/navigation';
import { parseGlobalSearch } from '@/app/search';
import { stackFor } from '@/app/stack';
import { dismissToast, holdToasts, showToast, useCurrentToast } from '@/app/toasts';
import { listenForNotificationNavigation } from '@/features/notifications';
import { t } from '@/shared/i18n';
import { HapticsHost } from '@/shared/lib/haptics';
import { useServiceWorker } from '@/shared/pwa/useServiceWorker';
import { Toast } from '@/shared/ui';
import { InstallGuideSheet } from '@/widgets/install-guide/InstallGuideSheet';

/** Root layout: motion config, haptics, global sheets, toasts, SW update and notification taps. */
export function AppRoot() {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <HapticsHost />
        <div className="flex min-h-dvh flex-1 flex-col">
          <Outlet />
        </div>
        <InstallGuideSheet />
        <ToastHost />
        <UpdatePrompt />
        <NotificationNavigation />
      </MotionConfig>
    </LazyMotion>
  );
}

function useCoverOpen(): boolean {
  return useRouterState({
    select: (s) => parseGlobalSearch(s.location.search as Record<string, unknown>).cover === 'scan',
  });
}

function ToastHost() {
  const toast = useCurrentToast();
  const coverOpen = useCoverOpen();
  const inTabs = useRouterState({ select: (s) => stackFor(s.location.pathname) !== null });
  useEffect(() => holdToasts(coverOpen), [coverOpen]);
  return <Toast toast={toast} onDismiss={dismissToast} placement={inTabs ? 'tab-bar' : 'bottom'} />;
}

/** «Nouvelle version disponible» · «Recharger» (design 03 §2.5.10); waits for the scanner and unsaved edits. */
function UpdatePrompt() {
  const { needRefresh, applyUpdate } = useServiceWorker();
  const coverOpen = useCoverOpen();
  const shown = useRef(false);
  const toastId = useRef<string | null>(null);
  const currentToast = useCurrentToast();
  const currentId = useRef<string | null>(null);
  useEffect(() => {
    currentId.current = currentToast?.id ?? null;
  }, [currentToast]);

  useEffect(() => {
    if (!needRefresh) return;
    const offer = () => {
      if (shown.current || coverOpen || hasUnsavedChanges()) return;
      shown.current = true;
      toastId.current = showToast({
        key: 'update',
        icon: RotateCw,
        message: t('update.available'),
        action: { label: t('update.reload'), onPress: () => void applyUpdate() },
        persistent: true,
      });
    };
    offer();
    // Persistent, but it can be swiped away; offer it again on the next return to the app.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (toastId.current !== null && currentId.current === toastId.current) return;
      shown.current = false;
      offer();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [needRefresh, coverOpen, applyUpdate]);
  return null;
}

/**
 * Notification taps (design 03 §1.6): the service worker posts the path; navigation waits while the
 * scanner is open or a sheet holds unsaved edits.
 */
function NotificationNavigation() {
  const coverOpen = useCoverOpen();
  const location = useRouterState({ select: (s) => s.location.href });
  const pending = useRef<string | null>(null);

  useEffect(
    () =>
      listenForNotificationNavigation((message) => {
        pending.current = message.path;
        if (!coverOpen && !hasUnsavedChanges()) {
          pending.current = null;
          navigateTo(message.path);
        }
      }),
    [coverOpen],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: retried on every location change
  useEffect(() => {
    const path = pending.current;
    if (!path || coverOpen || hasUnsavedChanges()) return;
    pending.current = null;
    navigateTo(path);
  }, [coverOpen, location]);
  return null;
}

export function NotFoundPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <p className="type-title-3">{t('errors.notFound')}</p>
      <button
        type="button"
        onClick={() => navigateTo('/', { replace: true })}
        className="min-h-11 type-body text-accent-fg outline-none focus-visible:focus-ring"
      >
        {t('item.notFound.home')}
      </button>
    </main>
  );
}
