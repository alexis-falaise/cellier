/**
 * The auth store and household API of the running app, registered once by the composition root
 * (src/app/session). Feature UI reads them here, so nothing in this feature imports the Supabase
 * client and tests can register fakes.
 */
import { useSyncExternalStore } from 'react';
import type { AuthState, AuthStore } from './authStore';
import type { HouseholdApi } from './household';

let authStore: AuthStore | null = null;
let householdApi: HouseholdApi | null = null;

export function registerAuthServices(services: { auth: AuthStore; household: HouseholdApi }): void {
  authStore = services.auth;
  householdApi = services.household;
}

export function getAuthStore(): AuthStore {
  if (!authStore) throw new Error('Auth services are not registered (src/app/session).');
  return authStore;
}

export function getHouseholdApi(): HouseholdApi {
  if (!householdApi) throw new Error('Auth services are not registered (src/app/session).');
  return householdApi;
}

const LOADING: AuthState = { status: 'loading' };
const noop = () => () => {};

export function useAuthState(): AuthState {
  const store = authStore;
  return useSyncExternalStore(
    store ? store.subscribe : noop,
    store ? store.getState : () => LOADING,
    store ? store.getState : () => LOADING,
  );
}
