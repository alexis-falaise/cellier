import { t } from '@/shared/i18n/fr';

export function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
    </main>
  );
}
