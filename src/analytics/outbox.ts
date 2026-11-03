import type { EventProps } from './context';

/** One captured event, exactly as it goes into `events[]` of the capture envelope. */
export interface WireEvent {
  insert_id: string;
  event_name: string;
  event_ts: string;
  visitor_id: string;
  session_id: string;
  person_hint?: { firebase_uid: string; tier: string };
  context: EventProps;
  properties: EventProps;
  /** Local only (stripped before sending): flush ordering. */
  priority: number;
}

/** The slice of MMKV the outbox needs (react-native-mmkv v4 instance). */
export interface OutboxStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean | void;
}

/** **Proposed** caps: the web keeps 1000 too; 1 MB bounds MMKV writes on a phone. */
export const OUTBOX_MAX_EVENTS = 1000;
export const OUTBOX_MAX_BYTES = 1_000_000;
/** The server clamps anything older to now-7d (inventory §3), so older events are dropped. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PERSIST_DEBOUNCE_MS = 250;
const KEY = 'outbox.v1';

export interface Outbox {
  push(e: WireEvent): void;
  /** Oldest first. */
  all(): readonly WireEvent[];
  remove(insertIds: ReadonlySet<string>): void;
  /** Drops events older than 7 days; returns how many. */
  prune(now: number): number;
  clear(): void;
  size(): number;
  bytes(): number;
  /** Writes pending changes now (background, fatal error). */
  persistNow(): void;
}

const sizeOf = (e: WireEvent) => JSON.stringify(e).length;

/**
 * MMKV-backed queue on its own instance (`mm-analytics`), not redux-persist. Writes are debounced
 * 250 ms (an event burst is one write); `persistNow()` runs on background and on a fatal error.
 */
export function createOutbox(
  storage: OutboxStorage,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): Outbox {
  let events: WireEvent[] = [];
  let sizes: number[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const raw = storage.getString(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      events = parsed.filter((e): e is WireEvent => !!e && typeof e.insert_id === 'string');
      sizes = events.map(sizeOf);
      total = sizes.reduce((a, b) => a + b, 0);
    }
  } catch {
    events = [];
  }

  const write = () => {
    timer = null;
    try {
      if (events.length === 0) storage.remove(KEY);
      else storage.set(KEY, JSON.stringify(events));
    } catch {
      // best effort: the in-memory queue still flushes
    }
  };
  const schedule = () => {
    if (timer === null) timer = timers.setTimeout(write, PERSIST_DEBOUNCE_MS);
  };
  const dropFirst = (n: number) => {
    for (let i = 0; i < n; i++) total -= sizes[i]!;
    events = events.slice(n);
    sizes = sizes.slice(n);
  };

  return {
    push(e) {
      const s = sizeOf(e);
      events.push(e);
      sizes.push(s);
      total += s;
      let drop = 0;
      let bytes = total;
      while (
        events.length - drop > 1 &&
        (events.length - drop > OUTBOX_MAX_EVENTS || bytes > OUTBOX_MAX_BYTES)
      ) {
        bytes -= sizes[drop]!;
        drop++;
      }
      if (drop) dropFirst(drop);
      schedule();
    },
    all: () => events,
    remove(ids) {
      if (ids.size === 0) return;
      const keepE: WireEvent[] = [];
      const keepS: number[] = [];
      total = 0;
      events.forEach((e, i) => {
        if (ids.has(e.insert_id)) return;
        keepE.push(e);
        keepS.push(sizes[i]!);
        total += sizes[i]!;
      });
      events = keepE;
      sizes = keepS;
      schedule();
    },
    prune(now) {
      const cutoff = now - OUTBOX_MAX_AGE_MS;
      const old = new Set(
        events.filter((e) => Date.parse(e.event_ts) < cutoff).map((e) => e.insert_id),
      );
      if (old.size) this.remove(old);
      return old.size;
    },
    clear() {
      events = [];
      sizes = [];
      total = 0;
      if (timer !== null) timers.clearTimeout(timer);
      write();
    },
    size: () => events.length,
    bytes: () => total,
    persistNow() {
      if (timer !== null) timers.clearTimeout(timer);
      write();
    },
  };
}
