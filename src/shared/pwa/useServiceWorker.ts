import { useRegisterSW } from 'virtual:pwa-register/react';

export function useServiceWorker() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  return { needRefresh, applyUpdate: () => updateServiceWorker(true) };
}
