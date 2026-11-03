import '../src/global.css';

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { ShareIntentProvider } from 'expo-share-intent';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { AnalyticsHost } from '@/analytics/AnalyticsHost';
import { reportClientError } from '@/analytics/errorHandlers';
import { startCrashReporting } from '@/analytics/runtime';
import { getJobEngine } from '@/jobs/runtime';
import { isTerminal } from '@/jobs/types';
import { startAuth } from '@/auth/gate';
import { cleanupIntakeCache } from '@/files/intake';
import { sweepResultCache } from '@/results/cache';
import { useShareIntentRouting } from '@/files/share-intent';
import { SyncLoading } from '@/auth/ui/SyncLoading';
import { useAppSelector } from '@/state/hooks';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { i18n } from '@/i18n';
import { useApplyLocale } from '@/i18n/useApplyLocale';
import { persistor, store } from '@/state/store';
import { Text } from '@/ui/components';
import { colors } from '@/ui/tokens';

void SplashScreen.preventAutoHideAsync();
// Crashlytics' chained JS handler first, then ours (client_error), before anything can throw.
startCrashReporting();

function ErrorFallback() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center bg-surface-0">
      <Text>{t('placeholders.errorBoundary')}</Text>
    </View>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportClientError(error, 'react', { record: true });
  }
  render() {
    if (this.state.failed) return <ErrorFallback />;
    return this.props.children;
  }
}

/** Starts the Firebase auth listener / sync gate; holds a loading view while the state resolves. */
function AuthGate({ children }: { children: ReactNode }) {
  const status = useAppSelector((s) => s.auth.status);
  useEffect(() => startAuth(store), []);
  if (status === 'unknown' || status === 'syncing') return <SyncLoading />;
  return children;
}

/** Routes a shared file to the intake screen once signed in (MA11). */
function ShareIntentRouter() {
  useShareIntentRouting();
  return null;
}

/** Sweeps the intake cache on start and on every foreground (24 h TTL; referenced jobs survive). */
function IntakeCacheSweeper() {
  useEffect(() => {
    const sweep = () => {
      const jobs = store.getState().jobs;
      const referenced = new Set<string>();
      for (const j of Object.values(jobs.byLocalId)) {
        // Terminal jobs no longer need the copy; upload_failed keeps it for "Try again".
        if (!isTerminal(j.state)) referenced.add(j.intakeFileId);
      }
      try {
        cleanupIntakeCache({ referencedIds: referenced });
        sweepResultCache();
      } catch {
        // best effort
      }
    };
    sweep();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sweep());
    return () => sub.remove();
  }, []);
  return null;
}

/** Starts the job engine (relaunch restore, AppState/NetInfo tracking) once the account is ready. */
function JobEngineHost() {
  const ready = useAppSelector((s) => s.auth.status === 'ready');
  useEffect(() => {
    if (!ready) return;
    const engine = getJobEngine();
    void engine.start();
    return () => engine.stop();
  }, [ready]);
  return null;
}

/** Applies `settings.locale` once persisted settings are rehydrated. */
function LocaleApplier() {
  useApplyLocale();
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <SafeAreaProvider>
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <ShareIntentProvider options={{ resetOnBackground: false }}>
              <PersistGate loading={null} persistor={persistor}>
                <LocaleApplier />
                <AnalyticsHost />
                <StatusBar style="light" />
                <ErrorBoundary>
                  <AuthGate>
                    <ShareIntentRouter />
                    <IntakeCacheSweeper />
                    <JobEngineHost />
                    <Stack
                      screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: colors.surface0 },
                      }}
                    />
                  </AuthGate>
                </ErrorBoundary>
              </PersistGate>
            </ShareIntentProvider>
          </I18nextProvider>
        </Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
