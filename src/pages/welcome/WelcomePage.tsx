import { Milk, Wheat, Wine } from 'lucide-react';
import { m } from 'motion/react';
import { useState } from 'react';
import { navigateTo, openSheet } from '@/app/navigation';
import { settled } from '@/app/session';
import { showToast } from '@/app/toasts';
import { currentInstallContext, GoogleSignInButton, LegalFootnote } from '@/features/auth';
import { t } from '@/shared/i18n';
import { usePreset } from '@/shared/lib/motion';
import { Button, CategoryTile, Wordmark } from '@/shared/ui';

/**
 * Welcome (design 03 §4.1.1). Installed app or desktop: Google sign-in. Safari tab on iOS: the
 * install path first («Ajouter à l’écran d’accueil»), sign-in in Safari stays possible. Other iOS
 * browsers cannot install: copy the link to open it in Safari.
 */
export function WelcomePage() {
  const [context] = useState(currentInstallContext);
  const [signInHere, setSignInHere] = useState(false);
  const transition = usePreset('smooth');

  const afterSignIn = async () => {
    await settled();
    navigateTo('/', { replace: true });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      showToast({ message: t('toast.linkCopied') });
    } catch {
      // Clipboard refused: nothing to report, the address bar still has the link.
    }
  };

  const showSignIn = context === 'standalone' || context === 'other' || signInHere;

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-[calc(var(--safe-top)+48px)] pb-[calc(var(--safe-bottom)+16px)]">
      <m.div
        className="flex flex-1 flex-col items-center justify-center text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition}
      >
        {/* Motif: wine, grain and milk tiles, set close together so they read as one mark above the wordmark. */}
        <div className="flex gap-2" aria-hidden="true">
          <CategoryTile icon={Wine} hue="plum" size={44} />
          <CategoryTile icon={Wheat} hue="honey" size={44} />
          <CategoryTile icon={Milk} hue="iris" size={44} />
        </div>
        <h1 className="mt-7">
          <Wordmark>{t('app.name')}</Wordmark>
        </h1>
        <p className="mt-2 max-w-[320px] type-body text-label-secondary">{t('welcome.tagline')}</p>
      </m.div>

      <div className="flex flex-col items-center gap-3">
        {showSignIn ? (
          <>
            <GoogleSignInButton onSignedIn={() => void afterSignIn()} />
            <LegalFootnote />
          </>
        ) : context === 'ios-safari' ? (
          <>
            <p className="max-w-[320px] text-center type-subhead text-label-secondary">{t('welcome.install.reason')}</p>
            <Button fullWidth onClick={() => openSheet({ sheet: 'install' })}>
              {t('welcome.install.cta')}
            </Button>
            <Button fullWidth variant="plain" onClick={() => setSignInHere(true)}>
              {t('welcome.install.skip')}
            </Button>
          </>
        ) : (
          <>
            <p className="max-w-[320px] text-center type-subhead text-label-secondary">
              {t('welcome.install.otherBrowser')}
            </p>
            <Button fullWidth onClick={() => void copyLink()}>
              {t('welcome.install.copyLink')}
            </Button>
            <Button fullWidth variant="plain" onClick={() => setSignInHere(true)}>
              {t('welcome.install.continueHere')}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
