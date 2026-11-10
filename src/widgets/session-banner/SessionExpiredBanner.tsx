import { KeyRound } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import { useActiveHousehold, useAppSession } from '@/app/session';
import { GoogleSignInButton } from '@/features/auth';
import { t } from '@/shared/i18n';
import { usePreset } from '@/shared/lib/motion';
import { StatusBanner } from '@/shared/ui';

/**
 * «Session expirée» (design 03 §2.5.9): pinned under the large title of every tab root while the
 * refresh token is rejected. «Se reconnecter» opens the Google sign-in inline; on success the
 * banner leaves with `smooth` and the outbox flushes (the session store triggers the sync).
 */
export function SessionExpiredBanner() {
  const { auth } = useAppSession();
  const household = useActiveHousehold();
  const [signingIn, setSigningIn] = useState(false);
  const transition = usePreset('smooth');
  const expired = auth.status === 'expired';
  const body =
    expired && auth.wrongAccountEmail !== null
      ? t('session.expired.wrongAccount', { household: household.name ?? '', email: auth.wrongAccountEmail })
      : t('session.expired.body');

  return (
    <AnimatePresence initial={false}>
      {expired ? (
        <m.div
          key="session-expired"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="flex flex-col gap-3 pt-2 pb-2"
        >
          <StatusBanner
            icon={KeyRound}
            text={
              <>
                <span className="block type-headline">{t('session.expired.title')}</span>
                <span className="block type-subhead text-label-secondary">{body}</span>
              </>
            }
            action={signingIn ? undefined : { label: t('session.expired.action'), onPress: () => setSigningIn(true) }}
          />
          {signingIn ? (
            <div className="px-4">
              <GoogleSignInButton />
            </div>
          ) : null}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
