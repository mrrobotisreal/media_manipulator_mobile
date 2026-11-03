/**
 * The process-wide analytics client and its wiring (MA07). Imports no store (the store imports the
 * API, which imports `track`): state is read through `getAppState()`, and `AnalyticsHost` (root
 * layout) binds the client once redux-persist has rehydrated.
 */
import * as Network from 'expo-network';
import * as Updates from 'expo-updates';
import { createMMKV } from 'react-native-mmkv';
import { getAppState } from '@/api/stateRef';
import { getActiveLocale } from '@/i18n';
import { appVariant } from '@/lib/appVariant';
import { uuidv4 } from '@/lib/ids';
import { appVersionString, userAgent } from '@/lib/userAgent';
import { createAnalyticsClient, type ClientDeps } from './client';
import { ANALYTICS_BASE_URL, ANALYTICS_WRITE_KEY, appPlatform, SDK } from './config';
import { connectionTypeOf, deviceContext, setConnectionType } from './context';
import { crashlyticsIdentify, crashlyticsReset, initCrashlytics } from './crashlytics';
import { installErrorHandlers } from './errorHandlers';
import { createLifecycle } from './lifecycle';
import { createOutbox } from './outbox';
import { ensureFreshSession, persistActivity } from './session';

const enabled = ANALYTICS_WRITE_KEY.length > 0;
if (!enabled && __DEV__) {
  console.info(
    '[analytics] EXPO_PUBLIC_ANALYTICS_WRITE_KEY is empty: analytics disabled in this build',
  );
}

export const analytics = createAnalyticsClient(enabled);

export function buildClientDeps(): ClientDeps {
  return {
    outbox: createOutbox(createMMKV({ id: 'mm-analytics' })),
    transport: {
      baseUrl: ANALYTICS_BASE_URL,
      writeKey: ANALYTICS_WRITE_KEY,
      userAgent: userAgent(),
      platform: appPlatform(),
      appVersion: appVersionString(),
      sdk: SDK,
      deviceContext,
      fetch: (...a) => fetch(...a),
      now: Date.now,
      log: __DEV__ ? (m, d) => console.debug(`[analytics] ${m}`, d ?? '') : undefined,
    },
    identity: (now) => {
      const fresh = ensureFreshSession(now);
      const s = getAppState()?.session;
      return fresh ?? { visitorId: s?.visitorId ?? '', sessionId: s?.sessionId ?? '' };
    },
    optedOut: () => getAppState()?.settings.analyticsOptOut ?? false,
    headerTier: () => getAppState()?.quota.tier ?? null,
    uuid: uuidv4,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    timers: globalThis,
    onIdentify: (uid, tier) =>
      crashlyticsIdentify(uid, {
        tier,
        locale: getActiveLocale(),
        app_version: appVersionString(),
      }),
    onReset: crashlyticsReset,
  };
}

let started = false;

/**
 * Module-load start (root layout import): Crashlytics first (its chained JS handler must be
 * installed before ours), then our global/rejection handlers. Idempotent.
 */
export function startCrashReporting(): void {
  if (started) return;
  started = true;
  initCrashlytics(appVariant());
  installErrorHandlers(
    {
      track: (name, props) => analytics.track(name, props),
      persistNow: () => analytics.persistNow(),
    },
    {
      devRejectionOptions: __DEV__
        ? // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('react-native/Libraries/promiseRejectionTrackingOptions').default
        : undefined,
    },
  );
}

export const lifecycle = createLifecycle({
  track: (name, props) => analytics.track(name, props),
  flush: () => void analytics.flush(),
  persistNow: () => analytics.persistNow(),
  foregrounded: (now) => void ensureFreshSession(now),
  backgrounded: (now) => persistActivity(now),
  otaUpdateId: () => (Updates.isEmbeddedLaunch ? null : (Updates.updateId ?? null)),
  now: Date.now,
});

/** Connection type for `context.connection_type`; a reconnect flushes the outbox. */
export function startNetworkWatch(): () => void {
  let connected: boolean | undefined;
  const apply = (st: Network.NetworkState) => {
    setConnectionType(connectionTypeOf(st.type));
    if (st.isConnected && connected === false) void analytics.flush();
    connected = st.isConnected;
  };
  void Network.getNetworkStateAsync()
    .then(apply)
    .catch(() => undefined);
  const sub = Network.addNetworkStateListener(apply);
  return () => sub.remove();
}
