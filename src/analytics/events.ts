/**
 * The app's typed event catalog: a mirror of `media-manipulator-analytics/internal/catalog/catalog.go`
 * (and `docs/EVENT_CATALOG.md` there), in the same shape as the web mirror
 * `media-manipulator-ui/lib/analytics/events.ts`. The analytics repo's `TestAppEventsParity` parses
 * THIS file (EVENTS / EVENT_PRIORITY / EventPropsMap, one entry per line), so keep the layout.
 *
 * THE RULE: no inline event-name string literals. Callers write `track(EVENTS.X, …)`; a lint rule
 * and `events.test.ts` enforce it. A new name lands in the analytics catalog (an
 * `appRolloutBatches` entry, deployed) BEFORE it is added here.
 *
 * Only names the app emits, plus the rest of a parity batch the app has started: `data_deleted`
 * (emitted since MA14) is in the catalog's "MA22 account" batch, so that batch's other three names
 * are declared here and emitted by MA22. Likewise MA50 declares the whole "MA52 photo" batch (17
 * names) and emits the editor/export core; MA51/MA52 emit the mask, heal, preset and gate names.
 *
 * Priorities MUST equal the catalog (the server re-stamps them; here they order the flush).
 * Properties: enums, buckets, counts and ids only. Never a file name, email or display name.
 */

/** 0 critical · 1 high · 2 normal · 3 low. Lower is more important. */
export type Priority = 0 | 1 | 2 | 3;

export const PRIORITY_CRITICAL: Priority = 0;
export const PRIORITY_HIGH: Priority = 1;
export const PRIORITY_NORMAL: Priority = 2;
export const PRIORITY_LOW: Priority = 3;

export const EVENTS = {
  // --- App lifecycle (MA07) ---------------------------------------------------
  SCREEN_VIEWED: 'screen_viewed',
  APP_OPENED: 'app_opened',
  APP_BACKGROUNDED: 'app_backgrounded',
  CLIENT_ERROR: 'client_error',

  // --- Auth (MA04) ------------------------------------------------------------
  AUTH_MODAL_OPENED: 'auth_modal_opened',
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
  SIGNIN_COMPLETED: 'signin_completed',
  AUTH_FAILED: 'auth_failed',
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  SIGNOUT: 'signout',

  // --- Tools + intake (MA10, MA11) --------------------------------------------
  TOOL_VIEWED: 'tool_viewed',
  OPTIONS_CHANGED: 'options_changed',
  FILE_SELECTED: 'file_selected',
  FILE_REJECTED: 'file_rejected',
  SHARE_INTENT_RECEIVED: 'share_intent_received',

  // --- Upload + jobs (MA12) ---------------------------------------------------
  UPLOAD_STARTED: 'upload_started',
  UPLOAD_COMPLETED: 'upload_completed',
  UPLOAD_FAILED: 'upload_failed',
  JOB_STARTED: 'job_started',
  JOB_COMPLETED: 'job_completed',
  JOB_FAILED: 'job_failed',
  ACTIVATION_FIRST_JOB_COMPLETED: 'activation_first_job_completed',

  // --- Results (MA13) ---------------------------------------------------------
  RESULT_VIEWED: 'result_viewed',
  RESULT_PREVIEWED: 'result_previewed',
  RESULT_COMPARE_USED: 'result_compare_used',
  RESULT_ARCHIVE_ENTRY_OPENED: 'result_archive_entry_opened',

  // --- Save / share / download (MA14) -----------------------------------------
  RESULT_DOWNLOAD_CLICKED: 'result_download_clicked',
  DOWNLOAD_STARTED: 'download_started',
  DOWNLOAD_COMPLETED: 'download_completed',
  DOWNLOAD_FAILED: 'download_failed',
  MEDIA_SAVED: 'media_saved',
  SHARE_LINK_COPIED: 'share_link_copied',

  // --- History, quota, AI, metadata (MA15, MA16, MA20, MA21) ------------------
  HISTORY_ITEM_REOPENED: 'history_item_reopened',
  QUOTA_WARNING_SHOWN: 'quota_warning_shown',
  QUOTA_EXCEEDED_SHOWN: 'quota_exceeded_shown',
  FEATURE_USED: 'feature_used',
  METADATA_INSPECTED: 'metadata_inspected',
  METADATA_SECTION_TOGGLED: 'metadata_section_toggled',
  METADATA_SEARCH_USED: 'metadata_search_used',
  METADATA_PRIVACY_FILTER_USED: 'metadata_privacy_filter_used',
  METADATA_DIFF_OPENED: 'metadata_diff_opened',

  // --- Account (catalog batch "MA22 account"; data_deleted since MA14) --------
  DATA_DELETED: 'data_deleted',
  RETENTION_SETTING_CHANGED: 'retention_setting_changed',
  DATA_EXPORT_REQUESTED: 'data_export_requested',
  SUBSCRIPTION_STATUS_VIEWED: 'subscription_status_viewed',

  // --- Push (catalog batch "MA24 push", MA24) ---------------------------------
  PUSH_PERMISSION_PROMPTED: 'push_permission_prompted',
  PUSH_PERMISSION_RESULT: 'push_permission_result',
  PUSH_OPENED: 'push_opened',

  // --- Aperture (catalog batch "MA52 photo", MM101; MA50 emits the core set) ---
  PHOTO_EDITOR_OPENED: 'photo_editor_opened',
  PHOTO_PROJECT_CREATED: 'photo_project_created',
  PHOTO_ADJUSTMENT_CHANGED: 'photo_adjustment_changed',
  PHOTO_MASK_ADDED: 'photo_mask_added',
  PHOTO_AI_MASK_REQUESTED: 'photo_ai_mask_requested',
  PHOTO_AI_MASK_COMPLETED: 'photo_ai_mask_completed',
  PHOTO_AI_MASK_FAILED: 'photo_ai_mask_failed',
  PHOTO_HEAL_REQUESTED: 'photo_heal_requested',
  PHOTO_HEAL_COMPLETED: 'photo_heal_completed',
  PHOTO_HEAL_FAILED: 'photo_heal_failed',
  PHOTO_PRESET_APPLIED: 'photo_preset_applied',
  PHOTO_COMPARE_USED: 'photo_compare_used',
  PHOTO_PROJECT_SAVED: 'photo_project_saved',
  PHOTO_EXPORT_STARTED: 'photo_export_started',
  PHOTO_EXPORT_COMPLETED: 'photo_export_completed',
  PHOTO_EXPORT_FAILED: 'photo_export_failed',
  PHOTO_EXPORT_GATED: 'photo_export_gated',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Must equal `internal/catalog/catalog.go`; `Record` so a missing priority is a compile error. */
export const EVENT_PRIORITY: Record<EventName, Priority> = {
  screen_viewed: PRIORITY_NORMAL,
  app_opened: PRIORITY_HIGH,
  app_backgrounded: PRIORITY_LOW,
  client_error: PRIORITY_HIGH,

  auth_modal_opened: PRIORITY_NORMAL,
  signup_started: PRIORITY_HIGH,
  signup_completed: PRIORITY_CRITICAL,
  signin_completed: PRIORITY_HIGH,
  auth_failed: PRIORITY_HIGH,
  password_reset_requested: PRIORITY_NORMAL,
  signout: PRIORITY_NORMAL,

  tool_viewed: PRIORITY_HIGH,
  options_changed: PRIORITY_LOW,
  file_selected: PRIORITY_HIGH,
  file_rejected: PRIORITY_HIGH,
  share_intent_received: PRIORITY_HIGH,

  upload_started: PRIORITY_HIGH,
  upload_completed: PRIORITY_HIGH,
  upload_failed: PRIORITY_CRITICAL,
  job_started: PRIORITY_CRITICAL,
  job_completed: PRIORITY_CRITICAL,
  job_failed: PRIORITY_CRITICAL,
  activation_first_job_completed: PRIORITY_CRITICAL,

  result_viewed: PRIORITY_NORMAL,
  result_previewed: PRIORITY_NORMAL,
  result_compare_used: PRIORITY_NORMAL,
  result_archive_entry_opened: PRIORITY_NORMAL,

  result_download_clicked: PRIORITY_HIGH,
  download_started: PRIORITY_CRITICAL,
  download_completed: PRIORITY_CRITICAL,
  download_failed: PRIORITY_CRITICAL,
  media_saved: PRIORITY_NORMAL,
  share_link_copied: PRIORITY_NORMAL,

  history_item_reopened: PRIORITY_NORMAL,
  quota_warning_shown: PRIORITY_HIGH,
  quota_exceeded_shown: PRIORITY_CRITICAL,
  feature_used: PRIORITY_NORMAL,
  metadata_inspected: PRIORITY_NORMAL,
  metadata_section_toggled: PRIORITY_LOW,
  metadata_search_used: PRIORITY_LOW,
  metadata_privacy_filter_used: PRIORITY_LOW,
  metadata_diff_opened: PRIORITY_NORMAL,

  data_deleted: PRIORITY_HIGH,
  retention_setting_changed: PRIORITY_HIGH,
  data_export_requested: PRIORITY_NORMAL,
  subscription_status_viewed: PRIORITY_CRITICAL,

  push_permission_prompted: PRIORITY_NORMAL,
  push_permission_result: PRIORITY_HIGH,
  push_opened: PRIORITY_HIGH,

  photo_editor_opened: PRIORITY_HIGH,
  photo_project_created: PRIORITY_HIGH,
  photo_adjustment_changed: PRIORITY_LOW,
  photo_mask_added: PRIORITY_NORMAL,
  photo_ai_mask_requested: PRIORITY_NORMAL,
  photo_ai_mask_completed: PRIORITY_NORMAL,
  photo_ai_mask_failed: PRIORITY_NORMAL,
  photo_heal_requested: PRIORITY_NORMAL,
  photo_heal_completed: PRIORITY_NORMAL,
  photo_heal_failed: PRIORITY_NORMAL,
  photo_preset_applied: PRIORITY_NORMAL,
  photo_compare_used: PRIORITY_LOW,
  photo_project_saved: PRIORITY_NORMAL,
  photo_export_started: PRIORITY_HIGH,
  photo_export_completed: PRIORITY_HIGH,
  photo_export_failed: PRIORITY_HIGH,
  photo_export_gated: PRIORITY_HIGH,
};

export type PropertyValue = string | number | boolean | null | undefined;

/** Catalog `media_kind` vocabulary. */
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'unknown';
export type AuthMethod = 'google' | 'email' | 'apple';

/* ---------------------------------------------------------------------------
 * Per-event property shapes. One key per line (the parity parser reads them).
 * ------------------------------------------------------------------------- */

export interface ScreenViewedProps {
  /** Route pattern (`/tool/[family]/[toolId]`), never a concrete id. */
  screen: string;
}

export interface AppOpenedProps {
  start: 'cold' | 'warm';
  /** `Updates.updateId` when running an EAS Update; absent for the embedded bundle. */
  ota_update_id?: string;
}

export interface AppBackgroundedProps {
  foreground_ms_bucket: 'lt_10s' | '10s_1m' | '1m_5m' | '5m_30m' | 'gte_30m';
}

export interface ClientErrorProps {
  /** Scrubbed and truncated (clientError.ts); never a stack. */
  message: string;
  stack_hash?: string;
  source?: 'window' | 'promise' | 'react' | 'manual';
  stage?: string;
  error_type?: string;
}

export interface AuthModalOpenedProps {
  source?: string;
  mode?: 'signin' | 'signup';
}

export interface AuthMethodProps {
  method: AuthMethod;
}

export interface AuthFailedProps {
  /** Absent for a sync failure (the method is not known on a cold-start sync). */
  method?: AuthMethod;
  stage?: string;
  reason?: string;
}

export interface PasswordResetRequestedProps {
  surface: 'app';
}

export type SignoutProps = Record<string, never>;

export interface ToolViewedProps {
  entry_point: string;
}

export interface OptionsChangedProps {
  option: string;
  value?: string | number | boolean;
}

export interface FileSelectedProps {
  /** Extension only, never a file name. */
  file_extension: string;
  size_bytes: number;
  file_size_mb?: number;
  media_kind?: MediaKind;
  source?: 'picker' | 'share';
}

export interface FileRejectedProps {
  reason: string;
  file_extension?: string;
  size_bytes?: number;
  limit_bytes?: number;
}

export interface ShareIntentReceivedProps {
  media_kind: MediaKind | 'mixed';
  count: number;
}

export interface UploadStartedProps {
  size_bytes?: number;
  transport?: 'post' | 'presigned_put';
}

export interface UploadCompletedProps {
  size_bytes?: number;
  duration_ms?: number;
  transport?: 'post' | 'presigned_put';
}

export interface UploadFailedProps {
  reason: string;
  status?: number;
  size_bytes?: number;
  duration_ms?: number;
  transport?: 'post' | 'presigned_put';
}

export interface JobStartedProps {
  job_id?: string;
  options_hash?: string;
  target_format?: string;
  source_format?: string;
}

export interface JobCompletedProps {
  job_id?: string;
  duration_ms?: number;
  output_bytes?: number;
  output_format?: string;
  queue_wait_ms?: number;
}

export interface JobFailedProps {
  job_id?: string;
  duration_ms?: number;
  reason: string;
  stage?: string;
}

export interface ActivationFirstJobCompletedProps {
  tool_slug: string;
  media_kind?: MediaKind;
  hours_since_signup: '<1h' | '1-24h' | '1-7d' | '7d+' | null;
  guest: boolean;
}

export interface ResultViewedProps {
  job_id: string;
  kind: string;
  surface: 'tool_page' | 'history';
  has_original: boolean;
}

export interface ResultPreviewedProps {
  job_id: string;
  preview_kind: string;
}

export interface ResultCompareUsedProps {
  job_id: string;
  kind: string;
  mode: 'wipe' | 'toggle';
}

export interface ResultArchiveEntryOpenedProps {
  job_id: string;
  entry_kind: string;
}

export interface ResultDownloadClickedProps {
  job_id: string;
  kind: string;
  surface: 'tool_page' | 'history';
  viewed_first: boolean;
}

export interface DownloadStartedProps {
  job_id: string;
  output_format: string;
  size_bytes?: number;
}

export interface DownloadCompletedProps {
  job_id: string;
  output_format: string;
  size_bytes: number;
  duration_ms: number;
}

export interface DownloadFailedProps {
  job_id: string;
  reason: string;
  status?: number;
}

export interface MediaSavedProps {
  destination: 'photos' | 'files' | 'share_sheet';
  media_kind: MediaKind;
}

export interface ShareLinkCopiedProps {
  job_kind: MediaKind;
  source: string;
}

export interface HistoryItemReopenedProps {
  kind: string;
  age_bucket: string;
  source: string;
}

export interface QuotaWarningShownProps {
  limit: number;
  remaining: number;
  scope: string;
}

export interface QuotaExceededShownProps {
  limit?: number;
  scope: string;
  tool_slug?: string;
}

export interface FeatureUsedProps {
  feature: string;
  action: string;
  value?: string | number;
}

export interface MetadataInspectedProps {
  surface: string;
  kind: string;
  tag_bucket: string;
  has_gps: boolean;
  has_c2pa: boolean;
}

export interface MetadataSectionToggledProps {
  category: string;
  open: boolean;
}

export type MetadataSearchUsedProps = Record<string, never>;

export interface MetadataPrivacyFilterUsedProps {
  flag: string;
}

export interface MetadataDiffOpenedProps {
  tool: string;
  removed_bucket: string;
  added_bucket: string;
  changed_bucket: string;
}

export type DataDeletedScope = 'item' | 'all' | 'account';
/** What was deleted. `all_files` is the delete-all action; `account` the whole account. */
export type DataDeletedKind = 'result' | 'project' | 'all_files' | 'account';

export interface DataDeletedProps {
  scope: DataDeletedScope;
  kind: DataDeletedKind;
}

/** Preset buckets for the account retention window; `custom` is any non-preset hour count. */
export type RetentionSettingBucket = '24h' | '7d' | '30d' | '90d' | '6mo' | '1y' | '2y' | 'custom';

export interface RetentionSettingChangedProps {
  from_bucket: RetentionSettingBucket;
  to_bucket: RetentionSettingBucket;
}

export type DataExportRequestedProps = Record<string, never>;

export interface SubscriptionStatusViewedProps {
  status: string;
  interval: string;
}

export interface PushPermissionPromptedProps {
  surface: 'long_job' | 'settings';
}

export interface PushPermissionResultProps {
  granted: boolean;
  surface: 'long_job' | 'settings';
}

export interface PushOpenedProps {
  tool: string;
  status: 'completed' | 'failed';
  app_state: 'background' | 'quit' | 'foreground';
}

/* Aperture (MM101 catalog, design PHOTO_EDITOR.md §10). Enums and buckets only: never a slider
 * value, a file name, a project name or a raw size. The app sends `source` app_intake | app_share |
 * history | projects. */
export type PhotoEditorSource =
  'upload' | 'tool_page' | 'result' | 'history' | 'projects' | 'app_intake' | 'app_share';
export type PhotoFormatProp = 'jpg' | 'png' | 'webp' | 'avif' | 'tiff';
export type PhotoFailReason =
  | 'locked'
  | 'limit'
  | 'quota'
  | 'unavailable'
  | 'too_large'
  | 'unsupported'
  | 'render'
  | 'timeout'
  | 'cancelled'
  | 'error';

export interface PhotoEditorOpenedProps {
  source: PhotoEditorSource;
  local_decode: boolean;
}

export interface PhotoProjectCreatedProps {
  source_format: string;
  megapixels_bucket: string;
  has_alpha: boolean;
}

export interface PhotoAdjustmentChangedProps {
  /** The layer type. */
  adjustment: string;
  /** The parameter KEY only, never its value. */
  param: string;
}

export interface PhotoMaskAddedProps {
  mask_kind: 'gradient' | 'radial' | 'brush' | 'luminosity' | 'colorRange' | 'subject';
}

export type PhotoAiRequestedProps = Record<string, never>;

export interface PhotoAiCompletedProps {
  ms: string;
}

export interface PhotoAiFailedProps {
  ms: string;
  reason: PhotoFailReason;
}

export interface PhotoPresetAppliedProps {
  preset_id: string;
  builtin: boolean;
  scope: 'builtin' | 'server' | 'local';
}

export interface PhotoCompareUsedProps {
  mode: 'hold' | 'split' | 'wipe';
}

export interface PhotoProjectSavedProps {
  layers: string;
  masks: string;
  heals: string;
  doc_bytes_bucket: string;
}

export interface PhotoExportStartedProps {
  format: PhotoFormatProp;
  megapixels_bucket: string;
  layers: string;
  masks: string;
  batch_size: string;
}

export interface PhotoExportCompletedProps {
  format: PhotoFormatProp;
  megapixels_bucket: string;
  ms: string;
  bytes_bucket?: string;
}

export interface PhotoExportFailedProps {
  format: PhotoFormatProp;
  megapixels_bucket: string;
  ms: string;
  reason: PhotoFailReason;
}

export interface PhotoExportGatedProps {
  reason: 'megapixels' | 'batch' | 'projects';
  tier: string;
  upgrade_path: 'signup' | 'premium' | 'pro' | 'none';
}

export interface EventPropsMap {
  screen_viewed: ScreenViewedProps;
  app_opened: AppOpenedProps;
  app_backgrounded: AppBackgroundedProps;
  client_error: ClientErrorProps;

  auth_modal_opened: AuthModalOpenedProps;
  signup_started: AuthMethodProps;
  signup_completed: AuthMethodProps;
  signin_completed: AuthMethodProps;
  auth_failed: AuthFailedProps;
  password_reset_requested: PasswordResetRequestedProps;
  signout: SignoutProps;

  tool_viewed: ToolViewedProps;
  options_changed: OptionsChangedProps;
  file_selected: FileSelectedProps;
  file_rejected: FileRejectedProps;
  share_intent_received: ShareIntentReceivedProps;

  upload_started: UploadStartedProps;
  upload_completed: UploadCompletedProps;
  upload_failed: UploadFailedProps;
  job_started: JobStartedProps;
  job_completed: JobCompletedProps;
  job_failed: JobFailedProps;
  activation_first_job_completed: ActivationFirstJobCompletedProps;

  result_viewed: ResultViewedProps;
  result_previewed: ResultPreviewedProps;
  result_compare_used: ResultCompareUsedProps;
  result_archive_entry_opened: ResultArchiveEntryOpenedProps;

  result_download_clicked: ResultDownloadClickedProps;
  download_started: DownloadStartedProps;
  download_completed: DownloadCompletedProps;
  download_failed: DownloadFailedProps;
  media_saved: MediaSavedProps;
  share_link_copied: ShareLinkCopiedProps;

  history_item_reopened: HistoryItemReopenedProps;
  quota_warning_shown: QuotaWarningShownProps;
  quota_exceeded_shown: QuotaExceededShownProps;
  feature_used: FeatureUsedProps;
  metadata_inspected: MetadataInspectedProps;
  metadata_section_toggled: MetadataSectionToggledProps;
  metadata_search_used: MetadataSearchUsedProps;
  metadata_privacy_filter_used: MetadataPrivacyFilterUsedProps;
  metadata_diff_opened: MetadataDiffOpenedProps;

  data_deleted: DataDeletedProps;
  retention_setting_changed: RetentionSettingChangedProps;
  data_export_requested: DataExportRequestedProps;
  subscription_status_viewed: SubscriptionStatusViewedProps;

  push_permission_prompted: PushPermissionPromptedProps;
  push_permission_result: PushPermissionResultProps;
  push_opened: PushOpenedProps;

  photo_editor_opened: PhotoEditorOpenedProps;
  photo_project_created: PhotoProjectCreatedProps;
  photo_adjustment_changed: PhotoAdjustmentChangedProps;
  photo_mask_added: PhotoMaskAddedProps;
  photo_ai_mask_requested: PhotoAiRequestedProps;
  photo_ai_mask_completed: PhotoAiCompletedProps;
  photo_ai_mask_failed: PhotoAiFailedProps;
  photo_heal_requested: PhotoAiRequestedProps;
  photo_heal_completed: PhotoAiCompletedProps;
  photo_heal_failed: PhotoAiFailedProps;
  photo_preset_applied: PhotoPresetAppliedProps;
  photo_compare_used: PhotoCompareUsedProps;
  photo_project_saved: PhotoProjectSavedProps;
  photo_export_started: PhotoExportStartedProps;
  photo_export_completed: PhotoExportCompletedProps;
  photo_export_failed: PhotoExportFailedProps;
  photo_export_gated: PhotoExportGatedProps;
}

/**
 * Property keys no event may carry (the server redacts them too). A file name, path, email or
 * display name is never analytics data.
 */
export const FORBIDDEN_PROP_KEYS: readonly string[] = [
  'name',
  'filename',
  'file_name',
  'path',
  'email',
  'display_name',
  'url',
];
