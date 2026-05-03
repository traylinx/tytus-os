/**
 * @tytus/host-api — the typed contract every Tytus app talks to instead
 * of importing shell hooks. Pure types + signature declarations; no
 * runtime code (the shell implements the contract via
 * `apps/host/src/runtime/loader.ts` and `apps/host/src/hooks/useHost.ts`).
 */

export type {
  AppKind,
  AppCategory,
  CorePermission,
  SharedStoragePermission,
  Permission,
  Manifest,
  ManifestWindow,
  ManifestStorage,
  ManifestStorageTable,
  ManifestEntry,
  ManifestFileAssociation,
  ManifestContributes,
  AliasManifestExtras,
  AliasRewriteDescriptor,
  InstalledAppRow,
} from './manifest';
export { APP_ID_PATTERN, sqlAppId, physicalTableName } from './manifest';

export type {
  AppMode,
  SendRequest,
  TransactionOutcome,
  ToolDef,
  Session,
  SessionCost,
  SessionStatus,
  AppCreateSession,
  AppCreateSessionOpts,
} from './session';

export type {
  ShellEventName,
  ShellEventPayload,
  EventsApi,
} from './events';

export type {
  HostClient,
  AppBootEnv,
  FsApi,
  FsChangeEvent,
  UserFolderName,
  DaemonApi,
  DaemonState,
  Agent,
  Pod,
  WindowsApi,
  AnyWindowArgs,
  NotificationsApi,
  NotificationLevel,
  NotifyOpts,
  ShellMenuApi,
  ShellMenuSpec,
  ShellMenuItem,
  I18nApi,
  StorageApi,
  AppDb,
  SharedDb,
  RunResult,
  MediaApi,
  AssetsApi,
} from './client';
export { makeHostForApp, useHost } from './client';

export {
  PermissionDeniedError,
  AssetNotFoundError,
  AssetTooLargeError,
  AssetEscapeError,
  ManifestValidationError,
} from './errors';

export type {
  UsageRecord,
  BrainSearchResult,
  BrainSearchResultSource,
  BrainEntry,
} from './daemon/types';
export { DaemonClientError } from './daemon/types';
export type {
  DaemonClient,
  CreateDaemonClientOpts,
} from './daemon/clients';
export { createDaemonClient } from './daemon/clients';
