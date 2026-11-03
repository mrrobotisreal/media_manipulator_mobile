import { Directory, Paths } from 'expo-file-system';
import {
  discardQueuedEvents,
  flushEvents,
  reset as resetAnalytics,
  track,
} from '@/analytics/track';
import { EVENTS } from '@/analytics/events';
import { ANALYTICS_BASE_URL } from '@/analytics/config';
import { accountSettingsApi } from '@/api/endpoints/accountSettings';
import { getIdToken } from '@/api/authToken';
import type { MmError } from '@/api/errors';
import { performSignOut } from '@/auth/signOut';
import { ORIGINALS_DIR, INTAKE_DIR } from '@/files/intake';
import { EXPORT_DIR } from '@/files/exportData';
import { RESULTS_DIR } from '@/results/cache';
import { persistor, store } from '@/state/store';
import { wipeAllStorage } from '@/state/persist';
import { jobsReset } from '@/state/slices/jobs';
import { reset as quotaReset } from '@/state/slices/quota';
import { analyticsOptOutSet, settingsReset } from '@/state/slices/settings';
import { visitorRotated } from '@/state/slices/session';
import { mmApi } from '@/api/mmApi';
import { analytics } from '@/analytics/runtime';
import type { DeleteAccountDeps, FinishDeps } from './deleteAccount';
import type { DeleteFilesDeps, DsrDeps, OptOutDeps } from './privacy';

/** Local files the app caches for the signed-in person (results, intake/original copies, exports). */
export function wipeCacheFiles(
  dirs: readonly string[] = [RESULTS_DIR, INTAKE_DIR, ORIGINALS_DIR, EXPORT_DIR],
): void {
  for (const name of dirs) {
    try {
      const d = new Directory(Paths.cache, name);
      if (d.exists) d.delete();
    } catch {
      // best effort
    }
  }
}

export function realOptOutDeps(): OptOutDeps {
  return {
    setOptOut: (v) => void store.dispatch(analyticsOptOutSet(v)),
    visitorId: () => store.getState().session.visitorId,
    fetch: (url, init) => fetch(url, init),
    analyticsBaseUrl: ANALYTICS_BASE_URL,
  };
}

export function realDsrDeps(): DsrDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    analyticsBaseUrl: ANALYTICS_BASE_URL,
    idToken: () => getIdToken(false),
    visitorId: () => store.getState().session.visitorId,
    discardQueued: discardQueuedEvents,
    resetAnalytics,
    rotateVisitor: () => void store.dispatch(visitorRotated()),
  };
}

export function realDeleteFilesDeps(): DeleteFilesDeps {
  return {
    deleteAll: () => store.dispatch(accountSettingsApi.endpoints.deleteAllData.initiate()).unwrap(),
    track: (name, props) => track(name, props),
    wipeLocal: () => {
      wipeCacheFiles([RESULTS_DIR, ORIGINALS_DIR, EXPORT_DIR]);
      store.dispatch(jobsReset());
    },
  };
}

export function realFinishDeps(): FinishDeps {
  return {
    resetAnalytics,
    rotateVisitor: () => void store.dispatch(visitorRotated()),
    trackAccountDeleted: () => track(EVENTS.DATA_DELETED, { scope: 'account', kind: 'account' }),
    flushAnalytics: () =>
      Promise.race([flushEvents(), new Promise<void>((r) => setTimeout(r, 3000))]),
    discardQueued: () => analytics.discardQueued(),
    signOutLocal: () =>
      performSignOut(store.dispatch, undefined, { silent: true }).catch(() => undefined),
    wipeFiles: () => wipeCacheFiles(),
    wipeStorage: () => {
      persistor.pause();
      wipeAllStorage();
    },
    resetState: () => {
      store.dispatch(settingsReset());
      store.dispatch(jobsReset());
      store.dispatch(quotaReset());
      store.dispatch(mmApi.util.resetApiState());
      // Resume persistence: only the fresh defaults (new visitorId) are written back.
      persistor.persist();
    },
  };
}

export function realDeleteAccountDeps(
  reauth: () => Promise<boolean>,
  finish: () => Promise<void>,
): DeleteAccountDeps {
  return {
    reauth,
    finish,
    call: async () => {
      const r = await store.dispatch(accountSettingsApi.endpoints.deleteAccount.initiate());
      if ('data' in r && r.data) return { ok: true as const, report: r.data };
      return { ok: false as const, error: (r as { error: MmError }).error };
    },
  };
}
