import { useEffect, useRef, useState } from 'react';
import { t } from '@/shared/i18n';
import { Spinner } from '@/shared/ui';
import type { SessionUser } from '../model/authStore';
import { loadGis } from '../model/gis';
import { createNonce } from '../model/nonce';
import { useOnline } from '../model/online';
import { getAuthStore } from '../model/service';

export interface GoogleSignInButtonProps {
  /** Called after a successful ID-token sign-in (not for the redirect fallback, which leaves the page). */
  onSignedIn?: ((user: SessionUser) => void) | undefined;
  /** Where the PKCE fallback returns; defaults to `/auth/callback`. */
  redirectPath?: string | undefined;
}

type Phase = 'loading' | 'gis' | 'fallback';
type ErrorKey = 'auth.error.generic' | 'auth.error.cancelled' | 'auth.error.offline';

const NONCE_KEY = 'cellier:gis-nonce';
const RENDER_TIMEOUT_MS = 4000;
const MAX_GIS_FAILURES = 2;

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

function rememberNonce(raw: string) {
  try {
    sessionStorage.setItem(NONCE_KEY, raw);
  } catch {
    // the in-memory copy is enough within this page
  }
}

function storedNonce(): string | null {
  try {
    return sessionStorage.getItem(NONCE_KEY);
  } catch {
    return null;
  }
}

/**
 * «Continuer avec Google» (design 03 §4.1.1): the Google Identity Services rendered button in a
 * 48 px slot, with a hashed nonce, then `signInWithIdToken`. If GIS cannot load or render, or its
 * flow fails twice, the slot swaps to our own button for the PKCE redirect to `/auth/callback`.
 */
export function GoogleSignInButton({ onSignedIn, redirectPath = '/auth/callback' }: GoogleSignInButtonProps) {
  const online = useOnline();
  const slotRef = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [phase, setPhase] = useState<Phase>(clientId ? 'loading' : 'fallback');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [dark, setDark] = useState(prefersDark);
  const failures = useRef(0);
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  });
  const isFallback = phase === 'fallback';

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const onChange = () => setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Load, initialise with a fresh nonce and render the GIS button (again when the theme changes).
  useEffect(() => {
    if (isFallback || !clientId || !online) return;
    let cancelled = false;
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const [gis, nonce] = await Promise.all([loadGis(), createNonce()]);
        const slot = slotRef.current;
        if (cancelled || !slot) return;
        rememberNonce(nonce.raw);
        gis.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
          callback: (response) => {
            const token = response.credential;
            if (!token) {
              setError('auth.error.cancelled');
              return;
            }
            setBusy(true);
            setError(null);
            void getAuthStore()
              .signInWithIdToken(token, storedNonce() ?? nonce.raw)
              .then((result) => {
                setBusy(false);
                if (result.ok) {
                  onSignedInRef.current?.(result.user);
                  return;
                }
                failures.current += 1;
                setError(result.reason === 'offline' ? 'auth.error.offline' : 'auth.error.generic');
                if (failures.current >= MAX_GIS_FAILURES) setPhase('fallback');
              });
          },
        });
        slot.replaceChildren();
        gis.renderButton(slot, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width: Math.min(400, Math.max(200, Math.floor(slot.clientWidth || 320))),
          locale: 'fr',
        });
        setPhase('gis');
        renderTimer = setTimeout(() => {
          if (!cancelled && !slot.querySelector('iframe, div[role="button"]')) setPhase('fallback');
        }, RENDER_TIMEOUT_MS);
      } catch {
        if (!cancelled) setPhase('fallback');
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(renderTimer);
    };
  }, [isFallback, online, dark]);

  const startRedirect = () => {
    setBusy(true);
    setError(null);
    void getAuthStore()
      .signInWithRedirect(`${window.location.origin}${redirectPath}`)
      .then(({ ok }) => {
        // On success the page is leaving for Google.
        if (!ok) {
          setBusy(false);
          setError(online ? 'auth.error.generic' : 'auth.error.offline');
        }
      });
  };

  const message: ErrorKey | null = !online ? 'auth.error.offline' : error;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="relative flex h-12 w-full max-w-[400px] items-center justify-center">
        {busy ? (
          <p className="flex items-center gap-2 type-body text-label-secondary" role="status">
            <Spinner size={16} />
            {t('auth.signingIn')}
          </p>
        ) : phase === 'fallback' ? (
          <FallbackButton disabled={!online} dark={dark} onPress={startRedirect} />
        ) : (
          <>
            {phase === 'loading' ? <Spinner size={16} className="absolute" /> : null}
            <div
              ref={slotRef}
              aria-disabled={!online || undefined}
              className={!online ? 'pointer-events-none w-full opacity-40' : 'flex w-full justify-center'}
            />
          </>
        )}
      </div>
      {message ? (
        <p className="text-center type-footnote text-label-secondary" role="alert">
          {t(message)}
        </p>
      ) : null}
    </div>
  );
}

/** Our own button for the PKCE redirect, drawn to Google's branding rules: pill, white or black, colour «G». */
function FallbackButton({ onPress, disabled, dark }: { onPress: () => void; disabled: boolean; dark: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={
        dark
          ? 'flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#8E918F] bg-[#131314] type-headline text-[#E3E3E3] outline-none focus-visible:focus-ring active:opacity-80 disabled:opacity-40'
          : 'flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white type-headline text-[#1F1F1F] outline-none focus-visible:focus-ring active:opacity-80 disabled:opacity-40'
      }
    >
      <GoogleG />
      {t('auth.google.fallback')}
    </button>
  );
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
