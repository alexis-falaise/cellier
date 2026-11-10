import { PartyPopper } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigateTo } from '@/app/navigation';
import { useActiveHousehold, useFirstSyncState } from '@/app/session';
import { t } from '@/shared/i18n';
import { OnboardingPage, Spinner } from '@/shared/ui';
import { HeroIcon } from '@/widgets/onboarding/HeroIcon';

const MIN_VISIBLE_MS = 1500;
/** Accueil shows its own first-sync skeletons past this. */
const MAX_VISIBLE_MS = 8000;

/**
 * «Bienvenue dans « Foyer » !» (design 03 §4.1.7): shown while the first pull of the joined
 * household runs, at least 1.5 s; then Accueil replaces it.
 */
export function JoinedPage() {
  const household = useActiveHousehold();
  const firstSync = useFirstSyncState();
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const cap = window.setTimeout(() => navigateTo('/', { replace: true }), MAX_VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(cap);
    };
  }, []);

  // Offline before the first pull: Accueil shows «Connexion nécessaire» with «Réessayer».
  const done = firstSync !== 'loading' && household.name !== null;
  useEffect(() => {
    if (minElapsed && (done || firstSync === 'offline')) navigateTo('/', { replace: true });
  }, [minElapsed, done, firstSync]);

  return (
    <OnboardingPage
      hero={<HeroIcon icon={PartyPopper} />}
      title={t('onboarding.joined.title', { household: household.name ?? '…' })}
      body={t('onboarding.joined.body')}
    >
      <Spinner className="mt-2" />
    </OnboardingPage>
  );
}
