/**
 * Web Push client (04-notifications-forecasting.md §1–§2). The service worker side lives in
 * src/sw.ts and shares ./model/payload.ts and ./model/pendingChange.ts.
 */
export type { PushEnvironment, PushManagerLike, PushSubscriptionLike } from './model/environment';
export { browserPushEnvironment, detectIOS } from './model/environment';
export { listenForNotificationNavigation, updateAppBadge } from './model/page';
export type {
  CellierNotificationData,
  DeclarativeNotification,
  NotificationKind,
  NotificationPath,
  PushPayload,
  SwNavigateMessage,
} from './model/payload';
export { isNotificationPath, notificationFromPush, notificationTargetPath } from './model/payload';
export type { PendingSubscriptionChange, PushSubscriptionJSONStrict } from './model/pendingChange';
export type {
  EnablePushResult,
  LocalPushRecord,
  LocalPushStore,
  PreferencesResult,
  PushClient,
  PushDeps,
  PushPreferences,
  PushStatus,
  PushSubscriptionPrefsUpdate,
} from './model/push';
export {
  disablePush,
  enablePush,
  localStoragePushStore,
  readPushPreferences,
  readPushStatus,
  reconcilePush,
  updatePushPreferences,
} from './model/push';
export type { PushStatusController, UsePushStatusOptions } from './model/usePushStatus';
export { usePushStatus } from './model/usePushStatus';
