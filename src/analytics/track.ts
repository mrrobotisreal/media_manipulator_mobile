/**
 * The analytics entry points every feature imports (signatures unchanged since the MA03 stub).
 * Names only via `EVENTS` (src/analytics/events.ts); the client lives in `runtime.ts`.
 */
import type { EventName, EventPropsMap } from './events';
import { analytics } from './runtime';

export { EVENTS, type EventName, type EventPropsMap } from './events';
export { clearContext, getContext, setContext, type EventProps } from './context';

/**
 * `context` overrides the ambient tool context for this one event (web `analytics.track`'s third
 * argument): job events fire after the tool screen is gone, so they carry their own `tool_slug`,
 * `media_kind` and `job_id`.
 */
export function track<N extends EventName>(
  name: N,
  ...rest: EventPropsMap[N] extends Record<string, never>
    ? [props?: EventPropsMap[N], context?: import('./context').EventProps]
    : [props: EventPropsMap[N], context?: import('./context').EventProps]
): void {
  analytics.track(name, rest[0], rest[1]);
}

/** Sets `person_hint` (sync gate `ready`) and the Crashlytics user. */
export function identify(uid: string, traits?: { tier?: string }): void {
  analytics.identify(uid, traits);
}

/** Sign-out: clears `person_hint` and the Crashlytics user; `visitorId` is kept. */
export function reset(): void {
  analytics.reset();
}
