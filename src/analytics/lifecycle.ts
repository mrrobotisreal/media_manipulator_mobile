import type { AppStateStatus } from 'react-native';
import type { AppBackgroundedProps, EventPropsMap } from './events';
import { EVENTS } from './events';

type LifecycleEvent = typeof EVENTS.APP_OPENED | typeof EVENTS.APP_BACKGROUNDED;

/** A foreground after at least this long in the background is a warm `app_opened`. */
export const WARM_START_MS = 30 * 1000;

export function foregroundBucket(ms: number): AppBackgroundedProps['foreground_ms_bucket'] {
  if (ms < 10_000) return 'lt_10s';
  if (ms < 60_000) return '10s_1m';
  if (ms < 5 * 60_000) return '1m_5m';
  if (ms < 30 * 60_000) return '5m_30m';
  return 'gte_30m';
}

export interface LifecycleDeps {
  track: <N extends LifecycleEvent>(name: N, props: EventPropsMap[N]) => void;
  flush: () => void;
  persistNow: () => void;
  /** Session rotation check (≥ 30 min away rotates; session.ts). */
  foregrounded: (now: number) => void;
  backgrounded: (now: number) => void;
  otaUpdateId: () => string | null;
  now: () => number;
}

/**
 * App lifecycle (ticket decision 7). `inactive` (iOS notification shade, app switcher) only
 * flushes; it never counts as background for warm starts or session rotation.
 */
export function createLifecycle(d: LifecycleDeps) {
  let foregroundSince = d.now();
  let backgroundAt: number | null = null;

  const opened = (start: 'cold' | 'warm') => {
    const ota = d.otaUpdateId();
    d.track(EVENTS.APP_OPENED, { start, ...(ota ? { ota_update_id: ota } : {}) });
  };

  return {
    /** First JS run after launch. */
    coldStart(): void {
      foregroundSince = d.now();
      opened('cold');
    },
    onAppState(next: AppStateStatus): void {
      const now = d.now();
      if (next === 'background') {
        if (backgroundAt !== null) return;
        backgroundAt = now;
        d.track(EVENTS.APP_BACKGROUNDED, {
          foreground_ms_bucket: foregroundBucket(now - foregroundSince),
        });
        d.backgrounded(now);
        d.persistNow();
        d.flush();
      } else if (next === 'inactive') {
        d.flush();
      } else if (next === 'active') {
        if (backgroundAt === null) return;
        const away = now - backgroundAt;
        backgroundAt = null;
        foregroundSince = now;
        d.foregrounded(now);
        if (away >= WARM_START_MS) opened('warm');
      }
    },
  };
}
