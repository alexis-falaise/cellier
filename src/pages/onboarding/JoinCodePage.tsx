import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { navigateTo } from '@/app/navigation';
import { useActiveHousehold } from '@/app/session';
import {
  formatInviteCode,
  INVITE_CODE_LENGTH,
  isCompleteInviteCode,
  normalizeInviteCode,
  useOnline,
} from '@/features/auth';
import { t } from '@/shared/i18n';
import { ListSection, TextField } from '@/shared/ui';
import { OnboardingForm } from '@/widgets/onboarding/OnboardingForm';
import { acceptInviteCode } from './acceptInvite';

const route = getRouteApi('/onboarding/join');

/** «Rejoindre un foyer» (design 03 §4.1.6): 8-character code, `?code=` prefill from an invite link. */
export function JoinCodePage() {
  const { code: prefill } = route.useSearch();
  const online = useOnline();
  const household = useActiveHousehold();
  const [code, setCode] = useState(() => normalizeInviteCode(prefill ?? ''));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const complete = isCompleteInviteCode(code);

  const join = async () => {
    if (!complete || !online) return;
    setBusy(true);
    setMessage(null);
    const result = await acceptInviteCode(code, household.name);
    if (result.ok) {
      navigateTo('/onboarding/joined', { replace: true });
      return;
    }
    setBusy(false);
    setMessage(result.message);
  };

  return (
    <OnboardingForm
      title={t('onboarding.join.title')}
      body={t('onboarding.join.body')}
      backTitle={t('onboarding.household.title')}
      submitLabel={t('onboarding.join.cta')}
      canSubmit={complete && online}
      busy={busy}
      onSubmit={() => void join()}
      message={online ? message : t('onboarding.join.offline')}
    >
      <ListSection label={t('onboarding.join.codeLabel')}>
        <TextField
          layout="stacked"
          label={t('onboarding.join.codeLabel')}
          value={formatInviteCode(code)}
          onChange={(value) => {
            setCode(normalizeInviteCode(value));
            setMessage(null);
          }}
          placeholder={t('onboarding.join.codePlaceholder')}
          autoComplete="one-time-code"
          enterKeyHint="go"
          maxLength={INVITE_CODE_LENGTH + 1}
          autoFocus={!prefill}
        />
      </ListSection>
    </OnboardingForm>
  );
}
