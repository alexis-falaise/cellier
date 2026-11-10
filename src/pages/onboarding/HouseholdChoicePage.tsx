import { House, HousePlus, Users } from 'lucide-react';
import { useEffect } from 'react';
import { navigateTo } from '@/app/navigation';
import { refreshMembership, signOut } from '@/app/session';
import { t } from '@/shared/i18n';
import { OnboardingPage, OptionCard } from '@/shared/ui';
import { HeroIcon } from '@/widgets/onboarding/HeroIcon';

/** «Votre foyer» (design 03 §4.1.4): create or join, after the first sign-in without a household. */
export function HouseholdChoicePage() {
  useEffect(() => {
    // A household created on another device since the last check sends this account home (the
    // session change re-runs the route guards).
    void refreshMembership();
  }, []);

  return (
    <OnboardingPage
      hero={<HeroIcon icon={House} />}
      title={t('onboarding.household.title')}
      body={t('onboarding.household.body')}
      secondary={{ label: t('account.signOut'), onPress: () => void signOut(), tone: 'quiet' }}
    >
      <div className="mt-4 flex w-full flex-col gap-3 text-left">
        <OptionCard
          icon={HousePlus}
          title={t('onboarding.household.create.title')}
          subtitle={t('onboarding.household.create.detail')}
          onPress={() => navigateTo('/onboarding/create')}
        />
        <OptionCard
          icon={Users}
          title={t('onboarding.household.join.title')}
          subtitle={t('onboarding.household.join.detail')}
          onPress={() => navigateTo('/onboarding/join')}
        />
      </div>
    </OnboardingPage>
  );
}
