import { t } from '@/shared/i18n/fr';

// Stub: the PKCE code exchange (supabase.auth.exchangeCodeForSession) lands with the auth feature.
export function AuthCallbackPage() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <p className="text-[var(--color-muted)]">{t('auth.signingIn')}</p>
    </main>
  );
}
