import { type ReactNode, useMemo, useState } from 'react';
import { closeSheet, popSheetPage, type SettingsPage, useOverlay } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { ScreenStack, Sheet, type StackScreen } from '@/shared/ui';
import { type SettingsStackEntry, settingsStack } from './model/pages';
import { type ExternalSettingsPage, registeredSettingsPage } from './registry';
import { AboutPage } from './ui/AboutPage';
import { AccountPage } from './ui/AccountPage';
import { CategoriesPage } from './ui/CategoriesPage';
import { CategoryPage, NewCategoryPage } from './ui/CategoryPage';
import { FallbackActivityPage, FallbackPantriesPage } from './ui/FallbackPages';
import { HouseholdPage } from './ui/HouseholdPage';
import { InvitePage } from './ui/InvitePage';
import { MemberPage } from './ui/MemberPage';
import { NotificationsPage } from './ui/NotificationsPage';
import { RootPage } from './ui/RootPage';

interface Route {
  page: SettingsPage | undefined;
  id: string | undefined;
}

function External({ page, id, fallback }: { page: ExternalSettingsPage; id: string | undefined; fallback: ReactNode }) {
  const Registered = registeredSettingsPage(page);
  return Registered ? <Registered id={id} /> : fallback;
}

function PageView({ entry }: { entry: SettingsStackEntry }) {
  switch (entry.page) {
    case 'root':
      return <RootPage />;
    case 'account':
      return <AccountPage />;
    case 'household':
      return <HouseholdPage />;
    case 'member':
      return <MemberPage userId={entry.id ?? ''} />;
    case 'invite':
      return <InvitePage />;
    case 'activity':
      return <External page="activity" id={undefined} fallback={<FallbackActivityPage />} />;
    case 'pantries':
    case 'pantry':
    case 'pantry-new':
      return <External page={entry.page} id={entry.id} fallback={<FallbackPantriesPage />} />;
    case 'categories':
      return <CategoriesPage />;
    case 'category':
      return <CategoryPage categoryId={entry.id ?? ''} />;
    case 'category-new':
      return <NewCategoryPage />;
    case 'notifications':
      return <NotificationsPage />;
    case 'about':
      return <AboutPage />;
  }
}

function SettingsStack({ route }: { route: Route }) {
  const entries = settingsStack(route.page, route.id);
  const keys = entries.map((e) => e.key).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: a stack is identified by its keys
  const screens: StackScreen[] = useMemo(
    () => entries.map((entry) => ({ key: entry.key, element: <PageView entry={entry} /> })),
    [keys],
  );
  return (
    <div className="flex h-full">
      <ScreenStack screens={screens} onBack={popSheetPage} />
    </div>
  );
}

/**
 * Réglages (03 §4.10–4.15), `?sheet=settings&page=…&id=…`: a large sheet whose pages push inside it
 * (02 §4). Mounted once by the tab shell; the URL owns which pages are open.
 */
export function SettingsSheetHost() {
  const overlay = useOverlay();
  const open = overlay.sheet === 'settings';
  // The last pages stay on screen while the sheet slides away.
  const [route, setRoute] = useState<Route | null>(null);
  if (open && (route === null || route.page !== overlay.page || route.id !== overlay.id)) {
    setRoute({ page: overlay.page, id: overlay.id });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
      detents={['large']}
      closeLabel={t('common.close')}
      aria-label={t('settings.title')}
      onExited={() => setRoute(null)}
    >
      {route ? <SettingsStack route={route} /> : null}
    </Sheet>
  );
}
