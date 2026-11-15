/**
 * The interface language is per user: saved on the account (auth user metadata), cached on the
 * device so the app starts in the right language, offline and before sign-in.
 *
 * - Picking a language in Réglages stores it on the device, sends it to the account and reloads.
 * - At start and at sign-in the account's language wins, unless a choice made on this device has not
 *   reached the account yet (picked offline): then that choice is sent instead.
 * - An account without a language (first launch after this feature, new account) gets the one the
 *   device is using, so push notifications are written in it too.
 */
import type { AuthStore, SessionUser } from '@/features/auth';
import { getLocale, isLocale, type Locale, readStoredLocale, setActiveLocale, storeLocale } from '@/shared/i18n';

const UNSENT_KEY = 'cellier.locale.unsent';
/** How long a language change waits for the account before reloading anyway. */
const SEND_TIMEOUT_MS = 1500;

export type LocaleDecision =
  /** Device and account agree. */
  | { action: 'none' }
  /** The account has none, or the device holds a newer choice: save the device's language. */
  | { action: 'send'; locale: Locale }
  /** The account's language differs (changed on another device): use it here. */
  | { action: 'adopt'; locale: Locale };

export function decideLocale(input: { device: Locale; account: string | null; unsent: boolean }): LocaleDecision {
  const account = isLocale(input.account) ? input.account : null;
  if (account === input.device) return { action: 'none' };
  if (account === null || input.unsent) return { action: 'send', locale: input.device };
  return { action: 'adopt', locale: account };
}

function readUnsent(): boolean {
  try {
    return globalThis.localStorage?.getItem(UNSENT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeUnsent(unsent: boolean): void {
  try {
    if (unsent) globalThis.localStorage?.setItem(UNSENT_KEY, '1');
    else globalThis.localStorage?.removeItem(UNSENT_KEY);
  } catch {
    // The choice still applies on this device.
  }
}

/** Sign-out: a choice that never reached the account must not be sent to the next account. */
export function forgetUnsentLocale(): void {
  writeUnsent(false);
}

async function send(auth: AuthStore | null, locale: Locale): Promise<void> {
  if (auth?.getState().status !== 'signedIn') return;
  const result = await auth.setLocale(locale);
  if (result.ok) writeUnsent(false);
}

/** Reloads into `locale`. Without storage the reload would start in the old language: switch in place. */
function restartIn(locale: Locale): void {
  storeLocale(locale);
  if (readStoredLocale() === locale && typeof window !== 'undefined') window.location.reload();
  else setActiveLocale(locale);
}

/** Called once per signed-in user and page load (start, sign-in). */
export function reconcileLocale(auth: AuthStore | null, user: SessionUser): void {
  const decision = decideLocale({ device: getLocale(), account: user.locale, unsent: readUnsent() });
  if (decision.action === 'none') writeUnsent(false);
  else if (decision.action === 'send') void send(auth, decision.locale);
  else restartIn(decision.locale);
}

/** Réglages › Langue. Resolves only when the language is unchanged; otherwise the page reloads. */
export async function chooseLocale(auth: AuthStore | null, locale: Locale): Promise<void> {
  if (locale === getLocale()) return;
  writeUnsent(true);
  storeLocale(locale);
  await Promise.race([
    send(auth, locale).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS)),
  ]);
  restartIn(locale);
}
