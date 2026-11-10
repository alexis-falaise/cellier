import { useState } from 'react';
import { navigateTo } from '@/app/navigation';
import { enterHousehold, getAppSession, refreshMembership, useSession } from '@/app/session';
import type { HouseholdId, PantryId } from '@/domain/types';
import { getHouseholdApi, useOnline } from '@/features/auth';
import { t } from '@/shared/i18n';
import { ChipGroup, ListSection, SectionFooter, TextField } from '@/shared/ui';
import { OnboardingForm } from '@/widgets/onboarding/OnboardingForm';

const NAME_MAX = 60;

function suggestions(): string[] {
  return t('pantry.suggestions')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «Créer le foyer» (design 03 §4.1.5): household name and first cellier, created online in one RPC. */
export function CreateHouseholdPage() {
  const { user } = useSession();
  const online = useOnline();
  const [householdName, setHouseholdName] = useState(() =>
    user?.firstName
      ? t('onboarding.create.householdDefault', { firstName: user.firstName })
      : t('onboarding.create.householdFallback'),
  );
  const [pantryName, setPantryName] = useState(() => t('pantry.defaultName'));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const household = householdName.trim();
  const pantry = pantryName.trim();
  const valid = household.length > 0 && pantry.length > 0;

  const create = async () => {
    setTouched(true);
    if (!valid || !online) return;
    setBusy(true);
    setFailed(false);
    // Another device may have created or joined a household meanwhile: never create a second one.
    await refreshMembership();
    const existing = getAppSession().household;
    if (existing.phase === 'member' && existing.id) {
      navigateTo('/', { replace: true });
      return;
    }
    const result = await getHouseholdApi().createHousehold({
      householdId: crypto.randomUUID() as HouseholdId,
      name: household,
      pantryId: crypto.randomUUID() as PantryId,
      pantryName: pantry,
    });
    if (result.ok) {
      await enterHousehold(result.householdId);
      navigateTo('/', { replace: true });
      return;
    }
    if (result.reason === 'exists') {
      await refreshMembership();
      navigateTo('/', { replace: true });
      return;
    }
    setBusy(false);
    setFailed(true);
  };

  const message = !online ? t('onboarding.create.offline') : failed ? t('onboarding.create.error') : null;

  return (
    <OnboardingForm
      title={t('onboarding.create.title')}
      backTitle={t('onboarding.household.title')}
      submitLabel={t('common.create')}
      canSubmit={valid && online}
      busy={busy}
      onSubmit={() => void create()}
      message={message}
    >
      <ListSection header={t('onboarding.create.householdLabel')}>
        <TextField
          layout="stacked"
          label={t('onboarding.create.householdLabel')}
          value={householdName}
          onChange={setHouseholdName}
          placeholder={t('onboarding.create.householdPlaceholder')}
          autoComplete="off"
          enterKeyHint="next"
          maxLength={NAME_MAX}
          error={touched && !household ? t('onboarding.create.householdRequired') : undefined}
        />
      </ListSection>
      <ListSection header={t('onboarding.create.pantryLabel')}>
        <TextField
          layout="stacked"
          label={t('onboarding.create.pantryLabel')}
          value={pantryName}
          onChange={setPantryName}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={NAME_MAX}
          error={touched && !pantry ? t('onboarding.create.pantryRequired') : undefined}
        />
      </ListSection>
      {/* 03 §4.1.5: field, then its suggestions, then the footer. */}
      <div className="-mt-2">
        <ChipGroup
          className="px-4"
          label={t('onboarding.create.pantryLabel')}
          options={suggestions().map((s) => ({ value: s, label: s }))}
          selected={pantry ? [pantry] : []}
          onToggle={setPantryName}
        />
        <SectionFooter className="mx-4 mt-3">{t('onboarding.create.footer')}</SectionFooter>
      </div>
    </OnboardingForm>
  );
}
