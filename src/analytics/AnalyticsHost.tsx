import { useEffect } from 'react';
import { AppState } from 'react-native';
import { accountApi } from '@/api/endpoints/account';
import { useAppSelector } from '@/state/hooks';
import { EVENTS, type ScreenViewedProps } from './events';
import { analytics, buildClientDeps, lifecycle, startNetworkWatch } from './runtime';
import { useScreenTracking } from './useScreenTracking';

const trackScreen = (name: typeof EVENTS.SCREEN_VIEWED, props: ScreenViewedProps) =>
  analytics.track(name, props);

/**
 * Root-layout host (inside PersistGate, so the session/settings slices are rehydrated): binds the
 * client, fires the cold `app_opened`, follows AppState / network, opt-out and tier changes, and
 * tracks `screen_viewed`.
 */
export function AnalyticsHost() {
  const optedOut = useAppSelector((s) => s.settings.analyticsOptOut);
  const tier = useAppSelector(
    (s) => accountApi.endpoints.getAccountMe.select()(s as never)?.data?.tier ?? s.quota.tier,
  );

  useEffect(() => {
    analytics.bind(buildClientDeps());
    lifecycle.coldStart();
    const app = AppState.addEventListener('change', (st) => lifecycle.onAppState(st));
    const stopNet = startNetworkWatch();
    return () => {
      app.remove();
      stopNet();
    };
  }, []);

  useEffect(() => analytics.optOutChanged(optedOut), [optedOut]);
  useEffect(() => {
    if (tier) analytics.tierChanged(tier);
  }, [tier]);

  useScreenTracking(trackScreen);
  return null;
}
