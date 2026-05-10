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
  ManifestAgentSkillDriver,
  ManifestAgentSkillRef,
  ManifestFileAssociation,
  ManifestContributes,
  AliasManifestExtras,
  AliasRewriteDescriptor,
  InstalledAppRow,
  ManifestValidationIssue,
  ManifestValidationResult,
} from './manifest';
export { APP_ID_PATTERN, sqlAppId, physicalTableName, validateManifest } from './manifest';

export type {
  AiApi,
  AiArtifact,
  AiContextPart,
  AiCreateArtifactInput,
  AiCreateThreadInput,
  AiEmbedTextInput,
  AiEmbeddingResult,
  AiEvent,
  AiGatewayPreference,
  AiGatewaySource,
  AiListArtifactsInput,
  AiListModelsInput,
  AiListThreadsInput,
  AiMemoryHit,
  AiMessage,
  AiModelInfo,
  AiMessageStatus,
  AiPrivacyMode,
  AiRole,
  AiSearchMemoryInput,
  AiSendMessageInput,
  AiStatus,
  AiThread,
  AiThreadStatus,
  AiUpdateThreadInput,
  AiWriteMemoryInput,
} from './ai';

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
  MusicDaemonApi,
  MusicStatus,
  MusicSearchResult,
  MusicStreamInfo,
  MusicProviderStatus,
  MusicConnectorCredentialSpec,
  MusicConnectorStatus,
  UnifiedMusicSearchResponse,
  Juli3taLibraryApi,
  Juli3taFileTrack,
  Juli3taFileLibraryResponse,
  LocalApi,
  LocalTool,
  LocalToolKind,
  LocalToolStatus,
  LocalJob,
  LocalJobEvent,
  LocalJobEventKind,
  LocalJobHandlers,
  LocalJobInput,
  TerminalLaunchInput,
  ResourcesApi,
  MissionCreateInput,
  MissionWriteFile,
  MissionWriteInput,
  MissionWriteResult,
  MissionsApi,
  TytusMission,
  TytusMissionSummary,
  TytusCapability,
  TytusResource,
  TytusResourceGraph,
  TytusResourceKind,
  TytusResourceStatus,
  TytusSandbox,
  TytusTrustTier,
  SkillsApi,
  SkillDriver,
  SkillListInput,
  SkillResolveInput,
  SkillSource,
  SkillStatus,
  TytusSkillPack,
  TytusSkillSummary,
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
  MicrophoneStream,
  AssetsApi,
} from './client';
// makeHostForApp + useHost are forward-declared in client.ts but
// implemented host-side in app/src/runtime/host-impl.ts. They MUST
// be imported from the host package, not from @tytus/host-api —
// re-exporting them here would yield a runtime "module does not
// provide export" error in dev (Vite can't resolve a `declare`
// to a real value).

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
