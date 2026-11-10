/**
 * Google sign-in (GIS + hashed nonce → `signInWithIdToken`; PKCE redirect fallback), the auth
 * session store, membership and household onboarding RPCs. The app composition root
 * (src/app/session) creates the store with the Supabase client and registers it here.
 */
export type {
  AuthClientLike,
  AuthState,
  AuthStore,
  ExchangeResult,
  KeyValueStorage,
  SessionUser,
  SignInResult,
} from './model/authStore';
export { createAuthStore, isNetworkError, LAST_USER_KEY, toSessionUser } from './model/authStore';
export { disableGoogleAutoSelect, loadGis } from './model/gis';
export type { Failure, HouseholdApi, HouseholdClient, InviteErrorKey } from './model/household';
export { createHouseholdApi, inviteErrorKey } from './model/household';
export { currentInstallContext, type InstallContext, installContext } from './model/installContext';
export {
  clearPendingInvite,
  formatInviteCode,
  INVITE_CODE_LENGTH,
  inviteCodeFromHash,
  isCompleteInviteCode,
  normalizeInviteCode,
  readPendingInvite,
  savePendingInvite,
  spellInviteCode,
} from './model/inviteCode';
export { base64url, createNonce, type Nonce, sha256Hex } from './model/nonce';
export { isOnline, useOnline } from './model/online';
export { getAuthStore, getHouseholdApi, registerAuthServices, useAuthState } from './model/service';
export { GoogleSignInButton, type GoogleSignInButtonProps } from './ui/GoogleSignInButton';
export { LegalFootnote } from './ui/LegalFootnote';
