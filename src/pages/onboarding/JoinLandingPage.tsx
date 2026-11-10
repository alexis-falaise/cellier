import { CircleAlert, CircleCheck, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigateTo, openSheet } from '@/app/navigation';
import { settled, useActiveHousehold, useSession } from '@/app/session';
import { showToast } from '@/app/toasts';
import type { InvitePeek } from '@/domain/types';
import {
  currentInstallContext,
  formatInviteCode,
  GoogleSignInButton,
  getHouseholdApi,
  inviteCodeFromHash,
  inviteErrorKey,
  LegalFootnote,
  readPendingInvite,
  savePendingInvite,
  spellInviteCode,
} from '@/features/auth';
import { t } from '@/shared/i18n';
import { Button, InviteCodeDisplay, OnboardingPage } from '@/shared/ui';
import { HeroIcon } from '@/widgets/onboarding/HeroIcon';
import { acceptInviteCode } from './acceptInvite';

type Phase = 'idle' | 'accepting' | 'accepted' | { error: string };

/**
 * Invite link `/join#CODE` (design 03 §4.1.2): the code stays in the fragment (never sent to a
 * server log), is kept in sessionStorage across sign-in, and `peek_invite` shows who invites.
 * Installed app or desktop: sign in, then join. Safari tab on iOS: accept here, then install;
 * the installed app finds the household after signing in with the same account.
 */
export function JoinLandingPage() {
  const [code] = useState(() => inviteCodeFromHash(window.location.hash) ?? readPendingInvite());
  const [context] = useState(currentInstallContext);
  const session = useSession();
  const household = useActiveHousehold();
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!code) {
      navigateTo('/onboarding/join', { replace: true });
      return;
    }
    savePendingInvite(code);
    let alive = true;
    void getHouseholdApi()
      .peekInvite(code)
      .then((result) => {
        if (alive && result.ok) setPeek(result.peek);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const accept = async () => {
    if (!code) return;
    setPhase('accepting');
    await settled();
    const result = await acceptInviteCode(code, household.name);
    if (!result.ok) {
      setPhase({ error: result.message });
      return;
    }
    if (context === 'ios-safari') setPhase('accepted');
    else navigateTo('/onboarding/joined', { replace: true });
  };

  if (!code) return null;

  if (phase === 'accepted') {
    return (
      <OnboardingPage
        hero={<HeroIcon icon={CircleCheck} />}
        title={t('join.accepted.title')}
        body={t('join.accepted.body')}
        primary={{ label: t('join.accepted.showSteps'), onPress: () => openSheet({ sheet: 'install' }) }}
        secondary={{ label: t('welcome.install.skip'), onPress: () => navigateTo('/', { replace: true }) }}
      />
    );
  }

  const blocked = peek ? inviteErrorKey(peek.status) : null;
  const error = typeof phase === 'object' ? phase.error : blocked ? t(blocked) : null;
  const body =
    peek?.householdName && peek.inviterFirstName
      ? t('join.body', { inviter: peek.inviterFirstName, household: peek.householdName })
      : t('join.bodyFallback');

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(formatInviteCode(code));
      setCopied(true);
      showToast({ message: t('toast.codeCopied') });
    } catch {
      // Clipboard refused: the code stays readable on screen.
    }
  };

  const signedIn = session.status === 'signedIn';

  return (
    <OnboardingPage hero={<HeroIcon icon={error ? CircleAlert : Mail} />} title={t('join.title')} body={body}>
      <InviteCodeDisplay
        code={formatInviteCode(code)}
        accessibleLabel={t('a11y.invite.code', { code: spellInviteCode(code) })}
        copied={copied}
        onCopy={() => void copyCode()}
        copyLabel={t('invite.copyCode')}
        copiedLabel={t('toast.codeCopied')}
      />
      <div className="mt-6 flex w-full flex-col items-center gap-3">
        {error ? (
          <>
            <p role="alert" className="type-subhead text-danger-fg">
              {error}
            </p>
            <Button fullWidth variant="secondary" onClick={() => navigateTo('/', { replace: true })}>
              {t('item.notFound.home')}
            </Button>
          </>
        ) : signedIn ? (
          <Button fullWidth loading={phase === 'accepting'} onClick={() => void accept()}>
            {t('onboarding.join.cta')}
          </Button>
        ) : (
          <>
            {context === 'ios-safari' ? (
              <p className="type-subhead text-label-secondary">{t('join.safari.step1')}</p>
            ) : null}
            <GoogleSignInButton redirectPath="/auth/callback" onSignedIn={() => void accept()} />
            <LegalFootnote />
          </>
        )}
      </div>
    </OnboardingPage>
  );
}
