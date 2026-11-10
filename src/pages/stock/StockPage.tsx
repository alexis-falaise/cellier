import { t } from '@/shared/i18n';

/** Placeholder: built by the screen agent. Reads its screen with `useScreen()` from '@/app/navigation'. */
export function StockPage() {
  return (
    <main className="flex min-h-full flex-col px-4 pt-[calc(var(--safe-top)+52px)] pb-(--content-bottom)">
      <h1 className="type-large-title">{t('tabs.stock')}</h1>
    </main>
  );
}
