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
  | 'options_changed';

export type EventProps = Record<string, string | number | boolean | null | undefined>;

export function track(name: StubEventName, props?: EventProps): void {
  if (__DEV__) console.debug('[analytics:stub] track', name, props);
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
