import '../src/global.css';

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Component, useEffect, type ReactNode } from 'react';
import { startAuth } from '@/auth/gate';
import { SyncLoading } from '@/auth/ui/SyncLoading';
import { useAppSelector } from '@/state/hooks';
import { View } from 'react-native';
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
            <PersistGate loading={null} persistor={persistor}>
              <LocaleApplier />
              <StatusBar style="light" />
              <ErrorBoundary>
                <AuthGate>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: colors.surface0 },
                    }}
                  />
                </AuthGate>
              </ErrorBoundary>
            </PersistGate>
          </I18nextProvider>
        </Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
