import { useRouter, useRouterState } from '@tanstack/react-router';
import { CloudOff, House, Package, ShoppingBasket } from 'lucide-react';
import { type ComponentType, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  goBack,
  openScanner,
  rememberTabLocation,
  ScreenContext,
  type ScreenInfo,
  selectTab,
  type TabKey,
} from '@/app/navigation';
import { syncNow, useFirstSyncState } from '@/app/session';
import { type StackEntry, stackFor, TAB_ROOTS, type TabStack } from '@/app/stack';
import { ItemEditSheetHost } from '@/features/item-edit/ItemEditSheetHost';
import { PantrySheetHost } from '@/features/pantries/PantrySheetHost';
import { ScannerCoverHost } from '@/features/scan-flow/ScannerCoverHost';
import { primeCamera } from '@/features/scanner';
import { SettingsSheetHost } from '@/features/settings/SettingsSheetHost';
import { t } from '@/shared/i18n';
import {
  EmptyState,
  keyboardInset,
  ScanButton,
  ScreenStack,
  type StackScreen,
  TabBar,
  type TabBarItem,
} from '@/shared/ui';
import { SyncSheet } from '@/widgets/sync/SyncSheet';

const TABS: readonly TabBarItem<TabKey>[] = [
  { key: 'home', label: t('tabs.home'), icon: House, href: TAB_ROOTS.home },
  { key: 'stock', label: t('tabs.stock'), icon: Package, href: TAB_ROOTS.stock },
  { key: 'groceries', label: t('tabs.groceries'), icon: ShoppingBasket, href: TAB_ROOTS.groceries },
];

/** Search params last seen for each screen pathname, so a screen under a push keeps its own. */
const searchByPath = new Map<string, Record<string, unknown>>();
/** Last stack of each tab, restored (and kept mounted) when switching back. */
const lastStacks = new Map<TabKey, TabStack>();

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVisible(keyboardInset() > 120);
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return visible;
}

/**
 * Tab shell (design 03 §3.1, 02 §4.4): one ScreenStack per visited tab, kept mounted so each tab keeps
 * its stack and scroll position; tabs switch instantly, pushes slide with `push`. Floating TabBar with
 * the detached ScanButton, and the global overlays driven by search params.
 */
export function TabLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const current = stackFor(pathname) ?? stackFor('/');
  const keyboard = useKeyboardVisible();
  const firstSync = useFirstSyncState();
  const containers = useRef(new Map<TabKey, HTMLDivElement>());

  useEffect(() => {
    rememberTabLocation(pathname, search);
    const top = current?.entries.at(-1);
    if (top) searchByPath.set(top.pathname, search);
    if (current) lastStacks.set(current.tab, current);
  }, [pathname, search, current]);

  if (!current) return null;
  const activeTab = current.tab;
  const tabs: TabKey[] = (['home', 'stock', 'groceries'] as const).filter(
    (tab) => tab === activeTab || lastStacks.has(tab),
  );

  const scrollToTop = (tab: TabKey) => {
    const container = containers.current.get(tab);
    const scrollers = container ? [...container.querySelectorAll<HTMLElement>('.overflow-y-auto')] : [];
    scrollers.find((el) => !el.parentElement?.hasAttribute('inert'))?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg-grouped">
      {firstSync === 'offline' ? (
        <div className="flex h-full flex-col justify-center pb-(--content-bottom)">
          <EmptyState
            icon={CloudOff}
            title={t('sync.firstSync.offline.title')}
            body={t('sync.firstSync.offline.body')}
            action={{ label: t('common.retry'), onPress: () => void syncNow() }}
          />
        </div>
      ) : (
        tabs.map((tab) => {
          const active = tab === activeTab;
          const stack = active ? current : (lastStacks.get(tab) as TabStack);
          return (
            <div
              key={tab}
              ref={(el) => {
                if (el) containers.current.set(tab, el);
                else containers.current.delete(tab);
              }}
              className={active ? 'absolute inset-0 flex' : 'invisible absolute inset-0 flex'}
              inert={!active || undefined}
              aria-hidden={active ? undefined : true}
            >
              <TabStackView stack={stack} active={active} search={active ? search : undefined} />
            </div>
          );
        })
      )}

      <TabBar
        label={t('a11y.tabs')}
        items={TABS}
        active={activeTab}
        hidden={keyboard}
        onSelect={(key, event) => {
          event.preventDefault();
          if (selectTab(key) === 'at-root') scrollToTop(key);
        }}
        scanButton={
          <ScanButton
            label={t('a11y.scan.button')}
            hint={t('a11y.scan.hint')}
            onScan={(mode, rect) => {
              // Tap: the click is the user activation, so the camera request goes first (02 §3.5).
              if (mode === 'add') primeCamera();
              openScanner(mode, rect);
            }}
            // Long press: the cover opened from a timer; the finger lift is the activation for the camera.
            onWithdrawRelease={() => primeCamera()}
          />
        }
      />

      <ScannerCoverHost />
      <SettingsSheetHost />
      <ItemEditSheetHost />
      <PantrySheetHost />
      <SyncSheet />
    </div>
  );
}

function TabStackView({
  stack,
  active,
  search,
}: {
  stack: TabStack;
  active: boolean;
  search: Record<string, unknown> | undefined;
}) {
  const keys = stack.entries.map((e) => e.key).join('|');
  const topSearch = JSON.stringify(search ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stack is identified by its keys and the top search
  const screens: StackScreen[] = useMemo(
    () =>
      stack.entries.map((entry, i) => {
        const isTop = i === stack.entries.length - 1;
        const info: ScreenInfo = {
          entry,
          tab: stack.tab,
          search: (isTop && search) || searchByPath.get(entry.pathname) || {},
          active: active && isTop,
        };
        return { key: entry.key, element: <ScreenView info={info} /> };
      }),
    [keys, topSearch, active],
  );
  return <ScreenStack screens={screens} onBack={goBack} />;
}

/** Renders the page component of the screen's file route (src/app/routes/_tabs/…). */
function ScreenView({ info }: { info: ScreenInfo }) {
  const router = useRouter();
  const route = (router.routesById as unknown as Record<string, { options: { component?: unknown } } | undefined>)[
    info.entry.routeId
  ];
  const Page = route?.options.component as ComponentType | undefined;
  if (!Page) return null;
  return (
    <ScreenContext.Provider value={info}>
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    </ScreenContext.Provider>
  );
}

export type { StackEntry };
