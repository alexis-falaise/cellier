import { getRouteApi } from '@tanstack/react-router';
import { CircleAlert, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigateTo } from '@/app/navigation';
import { settled } from '@/app/session';
import { type ExchangeResult, getAuthStore } from '@/features/auth';
import { t } from '@/shared/i18n';
import { OnboardingPage, Spinner } from '@/shared/ui';
import { HeroIcon } from '@/widgets/onboarding/HeroIcon';

const route = getRouteApi('/auth/callback');

type Outcome = 'pending' | Extract<ExchangeResult, { ok: false }>['reason'] | 'cancelled';

/** One exchange per code: React may mount the page twice, and a PKCE code is single-use. */
const exchanged = new Map<string, Promise<ExchangeResult>>();

/**
 * PKCE fallback return (design 03 §4.1.3). `detectSessionInUrl` is false, so the code is exchanged
 * here; the verifier lives in this browser's storage, so a callback opened in another context
 * (Safari instead of the installed app) fails with `wrongContext`.
 */
export function AuthCallbackPage() {
  const { code, error } = route.useSearch();
  const [outcome, setOutcome] = useState<Outcome>(() => (error ? 'cancelled' : code ? 'pending' : 'expired'));

  useEffect(() => {
    if (!code || error) return;
    let alive = true;
    let pending = exchanged.get(code);
    if (!pending) {
      pending = getAuthStore().exchangeCode(code);
      exchanged.set(code, pending);
    }
    void pending.then(async (result) => {
      if (!alive) return;
      if (result.ok) {
        await settled();
        navigateTo('/', { replace: true });
        return;
      }
      setOutcome(result.reason);
    });
    return () => {
      alive = false;
    };
  }, [code, error]);

  const restart = () => navigateTo('/welcome', { replace: true });

  if (outcome === 'pending') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <Spinner />
        <p className="type-subhead text-label-secondary" role="status">
          {t('auth.signingIn')}
        </p>
      </main>
    );
  }

  if (outcome === 'wrongContext') {
    return (
      <OnboardingPage
        hero={<HeroIcon icon={Smartphone} />}
        title={t('auth.callback.wrongContext.title')}
        body={t('auth.callback.wrongContext.body')}
        secondary={{ label: t('auth.callback.restart'), onPress: restart }}
      />
    );
  }

  const message =
    outcome === 'cancelled'
      ? t('auth.error.cancelled')
      : outcome === 'offline'
        ? t('auth.error.offline')
        : outcome === 'expired'
          ? t('auth.callback.expired')
          : t('auth.error.generic');
  return (
    <OnboardingPage
      hero={<HeroIcon icon={CircleAlert} />}
      title={message}
      primary={{ label: t('auth.callback.restart'), onPress: restart }}
    />
  );
}
