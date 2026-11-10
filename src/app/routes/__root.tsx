import { createRootRoute, Outlet } from '@tanstack/react-router';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import { t } from '@/shared/i18n/fr';
import { useServiceWorker } from '@/shared/pwa/useServiceWorker';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <p className="p-6">{t('errors.notFound')}</p>,
});

function RootLayout() {
  useServiceWorker();
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="safe-area-p flex flex-1 flex-col">
          <Outlet />
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
