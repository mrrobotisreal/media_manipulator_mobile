/**
 * Analytics stub (MA03). MA07 replaces the bodies; the signatures are the contract.
 * Nothing else in the app imports an analytics transport before MA07.
 */
export type StubEventName =
  | 'client_error'
  // Auth (MA04). Names match the analytics catalog (media-manipulator-analytics/internal/catalog).
  | 'auth_modal_opened'
  | 'signup_started'
  | 'signup_completed'
  | 'signin_completed'
  | 'auth_failed'
  | 'password_reset_requested'
  | 'signout'
  // Tools (MA10).
  | 'tool_viewed'
  | 'options_changed'
  // File intake (MA11).
  | 'file_selected'
  | 'file_rejected'
  | 'share_intent_received'
  // Upload + jobs (MA12).
  | 'upload_started'
  | 'upload_completed'
  | 'upload_failed'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'activation_first_job_completed'
  // Results (MA13).
  | 'result_viewed'
  | 'result_previewed'
  | 'result_compare_used'
  | 'result_archive_entry_opened'
  // Save / share / download (MA14).
  | 'result_download_clicked'
  | 'download_started'
  | 'download_completed'
  | 'download_failed'
  | 'media_saved'
  | 'share_link_copied'
  | 'data_deleted'
  // History (MA15).
  | 'history_item_reopened'
  // Quota (MA16).
  | 'quota_warning_shown'
  | 'quota_exceeded_shown'
  // Metadata (MA21). Catalog: metadata_* in internal/catalog/catalog.go.
  | 'metadata_inspected'
  | 'metadata_section_toggled'
  | 'metadata_search_used'
  | 'metadata_privacy_filter_used'
  | 'metadata_diff_opened';

export type EventProps = Record<string, string | number | boolean | null | undefined>;

/**
 * `context` overrides the ambient tool context for this one event (web `analytics.track`'s third
 * argument): job events fire after the tool screen is gone, so they carry their own `tool_slug`,
 * `media_kind` and `job_id`.
 */
export function track(name: StubEventName, props?: EventProps, context?: EventProps): void {
  if (__DEV__) console.debug('[analytics:stub] track', name, props, context);
}

export function identify(uid: string, traits?: EventProps): void {
  if (__DEV__) console.debug('[analytics:stub] identify', uid, traits);
}

export function reset(): void {
  if (__DEV__) console.debug('[analytics:stub] reset');
}

/**
 * Context patch (MA10 stub; MA07 replaces it with the real context store). `tool_slug` and
 * `media_kind` ride on every event while a tool screen is open (web ToolAnalyticsContext precedent).
 */
const context: Record<string, string | number | boolean | null | undefined> = {};

export function setContext(patch: EventProps): void {
  Object.assign(context, patch);
}

export function clearContext(keys: string[]): void {
  for (const k of keys) delete context[k];
}

export function getContext(): EventProps {
  return { ...context };
}
