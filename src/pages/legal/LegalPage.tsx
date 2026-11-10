import { goBack } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { BackButton, NavBar } from '@/shared/ui';

/** Placeholder: static legal pages (content out of scope, design 03 §1.2). */
function LegalPage({ title }: { title: string }) {
  return (
    <main className="flex min-h-dvh flex-col pb-[calc(var(--safe-bottom)+16px)]">
      <NavBar
        leading={
          <BackButton
            previousTitle={t('common.back')}
            fallbackLabel={t('common.back')}
            accessibleLabel={t('common.back')}
            onPress={goBack}
          />
        }
      />
      <div className="flex flex-col gap-3 px-4 pt-4">
        <h1 className="type-title-1">{title}</h1>
        <p className="type-body text-label-secondary">{t('legal.pending')}</p>
      </div>
    </main>
  );
}

export function TermsPage() {
  return <LegalPage title={t('legal.terms.title')} />;
}

export function PrivacyPage() {
  return <LegalPage title={t('legal.privacy.title')} />;
}
