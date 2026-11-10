/** Public API of the sync module. Screens use the session functions, the React hooks and src/entities selectors. */

export type {
  ActivityEntry,
  AttentionReason,
  OutboxEntry,
  OutboxState,
  StoreSnapshot,
  SyncTrigger,
} from './contract';
export { MutationValidationError } from './contract';
export type { CellierSyncEngine, EngineOptions } from './engine';
export { createSyncEngine } from './engine';
export type { EngineEnvironment, ManualEnvironment } from './environment';
export { createBrowserEnvironment, createManualEnvironment } from './environment';
export { hlcDeviceId } from './hlc';
export { syncActions, syncReactBindings, useMutate, useStore, useSyncEngine, useSyncStatus } from './react';
export { PENDING_SEQ } from './reducers';
export {
  getSyncEngine,
  getSyncStore,
  mutate,
  readActiveHouseholdId,
  type StartSyncOptions,
  signOutSync,
  startSync,
  stopSync,
  switchHousehold,
} from './session';
export type { CellierSnapshot, CellierStore, HouseholdNotice } from './store';
export { createSyncStore } from './store';
export type { ChannelHandlers, ChannelStatus, SyncTransport, TransportErrorKind } from './transport';
export { TransportError } from './transport';
