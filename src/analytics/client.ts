import { clearContext, eventContext, getContext, setContext, type EventProps } from './context';
import { createErrorGate } from './clientError';
import {
  EVENTS,
  EVENT_PRIORITY,
  FORBIDDEN_PROP_KEYS,
  PRIORITY_CRITICAL,
  PRIORITY_HIGH,
  type ClientErrorProps,
  type EventName,
  type EventPropsMap,
} from './events';
import type { Outbox, WireEvent } from './outbox';
import {
  backoffDelay,
  MAX_SEND_ATTEMPTS,
  sendBatch,
  splitBatches,
  type TransportConfig,
} from './transport';

export { clearContext, getContext, setContext, type EventProps };

/** Flush policy (ticket decision 5). */
export const HIGH_PRIORITY_DELAY_MS = 2_000;
export const FLUSH_INTERVAL_MS = 15_000;
export const FLUSH_AT_COUNT = 20;
/** Events tracked before the store is bound (boot, before rehydration) wait here. */
export const PRE_BIND_BUFFER = 50;

export interface Identity {
  visitorId: string;
  sessionId: string;
}

export interface ClientDeps {
  outbox: Outbox;
  transport: TransportConfig;
  /** Runs the 30-minute idle rotation for this track time and returns the ids to stamp. */
  identity: (now: number) => Identity;
  optedOut: () => boolean;
  /** Tier from the latest API response headers (`quota.tier`), for `person_hint` refreshes. */
  headerTier: () => string | null;
  uuid: () => string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  /** Crashlytics identity hooks (identify / reset). */
  onIdentify?: (uid: string, tier: string) => void;
  onReset?: () => void;
}

interface Pending {
  name: EventName;
  props: EventProps;
  context?: EventProps;
  ts: number;
}

/**
 * The app analytics client: one per process (`runtime.ts`). Disabled (no capture, no outbox) when
 * no write key is configured. Before `bind(deps)` events wait in a small buffer so boot-time events
 * get the rehydrated visitor id.
 */
export function createAnalyticsClient(enabled: boolean) {
  let deps: ClientDeps | null = null;
  let buffer: Pending[] = [];
  let person: { firebase_uid: string; tier: string } | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushAt = Infinity;
  let interval: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let lastSession = '';
  /** Bumped by `discardQueued`: a drain that started earlier stops before its next batch. */
  let epoch = 0;
  const errors = createErrorGate();

  function capture(d: ClientDeps, p: Pending): void {
    const id = d.identity(p.ts);
    lastSession = id.sessionId;
    let props = p.props;
    if (p.name === EVENTS.CLIENT_ERROR) {
      const admitted = errors.admit(props as unknown as ClientErrorProps, id.sessionId);
      if (!admitted) return;
      props = admitted as unknown as EventProps;
    }
    const tier = person?.tier ?? d.headerTier() ?? undefined;
    const event: WireEvent = {
      insert_id: d.uuid(),
      event_name: p.name,
      event_ts: new Date(p.ts).toISOString(),
      visitor_id: id.visitorId,
      session_id: id.sessionId,
      ...(person ? { person_hint: { ...person } } : {}),
      context: compact({ ...eventContext(tier), ...p.context }),
      properties: compact(props),
      priority: EVENT_PRIORITY[p.name],
    };
    d.outbox.push(event);
    schedule(d, event.priority);
  }

  function schedule(d: ClientDeps, priority: number): void {
    if (priority === PRIORITY_CRITICAL || d.outbox.size() >= FLUSH_AT_COUNT) {
      void flush();
      return;
    }
    if (priority === PRIORITY_HIGH) flushIn(d, HIGH_PRIORITY_DELAY_MS);
    if (interval === null) {
      interval = d.timers.setTimeout(() => {
        interval = null;
        void flush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  function flushIn(d: ClientDeps, ms: number): void {
    const at = d.now() + ms;
    if (flushTimer !== null && flushAt <= at) return;
    if (flushTimer !== null) d.timers.clearTimeout(flushTimer);
    flushAt = at;
    flushTimer = d.timers.setTimeout(() => {
      flushTimer = null;
      flushAt = Infinity;
      void flush();
    }, ms);
  }

  function stopTimers(d: ClientDeps): void {
    if (flushTimer !== null) d.timers.clearTimeout(flushTimer);
    if (interval !== null) d.timers.clearTimeout(interval);
    flushTimer = null;
    interval = null;
    flushAt = Infinity;
  }

  async function drain(d: ClientDeps): Promise<void> {
    const startedAt = epoch;
    d.outbox.prune(d.now());
    // Most important first (stable within a priority).
    const queued = [...d.outbox.all()].sort((a, b) => a.priority - b.priority);
    for (const batch of splitBatches(queued)) {
      for (let attempt = 0; ; attempt++) {
        if (d.optedOut() || epoch !== startedAt) return;
        const outcome = await sendBatch(d.transport, batch);
        if (epoch !== startedAt) return;
        if (outcome.kind !== 'retry') {
          d.outbox.remove(new Set(batch.map((e) => e.insert_id)));
          break;
        }
        // Kept in the outbox for the next trigger after 5 attempts.
        if (attempt + 1 >= MAX_SEND_ATTEMPTS) return;
        await d.sleep(backoffDelay(attempt, d.random));
      }
    }
  }

  function flush(): Promise<void> {
    const d = deps;
    if (!d || d.optedOut() || d.outbox.size() === 0) return inFlight ?? Promise.resolve();
    if (inFlight) {
      again = true;
      return inFlight;
    }
    stopTimers(d);
    inFlight = (async () => {
      do {
        again = false;
        await drain(d);
      } while (again && !d.optedOut() && d.outbox.size() > 0);
    })()
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    track<N extends EventName>(name: N, props?: EventPropsMap[N], context?: EventProps): void {
      if (__DEV__) console.debug('[analytics] track', name, props, context);
      if (!enabled) return;
      const p: Pending = { name, props: (props ?? {}) as EventProps, context, ts: Date.now() };
      const forbidden = Object.keys(p.props).find((k) => FORBIDDEN_PROP_KEYS.includes(k));
      if (forbidden) {
        if (__DEV__) console.warn(`[analytics] dropped ${name}: forbidden property "${forbidden}"`);
        return;
      }
      if (!deps) {
        if (buffer.length < PRE_BIND_BUFFER) buffer.push(p);
        return;
      }
      if (deps.optedOut()) return;
      capture(deps, p);
    },
    identify(uid: string, traits?: { tier?: string }): void {
      person = { firebase_uid: uid, tier: traits?.tier ?? person?.tier ?? 'free' };
      deps?.onIdentify?.(uid, person.tier);
    },
    reset(): void {
      person = null;
      deps?.onReset?.();
    },
    /** `/account/me` or response headers report another tier for the signed-in user. */
    tierChanged(tier: string): void {
      if (!person || person.tier === tier) return;
      person = { ...person, tier };
      deps?.onIdentify?.(person.firebase_uid, tier);
    },
    /** Called once the store has rehydrated; replays the boot buffer. */
    bind(d: ClientDeps): void {
      if (deps || !enabled) return;
      deps = d;
      const pending = buffer;
      buffer = [];
      if (deps.optedOut()) return;
      for (const p of pending) capture(deps, p);
    },
    flush,
    /** Opt-out switched on: stop capture, clear the outbox, stop the timers. */
    optOutChanged(optedOut: boolean): void {
      if (!deps || !optedOut) return;
      stopTimers(deps);
      buffer = [];
      deps.outbox.clear();
    },
    /**
     * Account deletion / analytics erase (MA22): the old person's queued events must never be sent.
     * Stops both timers, empties the pre-bind buffer and the outbox, and makes a running drain stop
     * before its next batch. Capture stays enabled (the new anonymous identity keeps tracking).
     */
    discardQueued(): void {
      epoch += 1;
      buffer = [];
      if (!deps) return;
      stopTimers(deps);
      deps.outbox.clear();
    },
    persistNow(): void {
      deps?.outbox.persistNow();
    },
    currentSessionId: () => lastSession,
    isEnabled: () => enabled,
    hasPerson: () => person !== null,
  };
}

export type AnalyticsClient = ReturnType<typeof createAnalyticsClient>;

/** Drops `undefined` members (JSON would drop them anyway; keeps the outbox byte count honest). */
function compact(o: EventProps): EventProps {
  const out: EventProps = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
