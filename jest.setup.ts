/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-mmkv', () => {
  const stores = new Map<string, Map<string, string>>();
  const create = (id: string) => {
    if (!stores.has(id)) stores.set(id, new Map());
    const m = stores.get(id)!;
    return {
      set: (k: string, v: string) => void m.set(k, v),
      getString: (k: string) => m.get(k),
      remove: (k: string) => m.delete(k),
      delete: (k: string) => m.delete(k),
      clearAll: () => m.clear(),
      getAllKeys: () => [...m.keys()],
      contains: (k: string) => m.has(k),
    };
  };
  return {
    createMMKV: (opts?: { id?: string }) => create(opts?.id ?? 'default'),
    MMKV: function (opts?: { id?: string }) {
      return create(opts?.id ?? 'default');
    },
  };
});

jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => ({}) }));

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(),
  isLoaded: () => true,
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i + 1),
  randomUUID: () => {
    mockUuidCounter += 1;
    const n = mockUuidCounter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${n}`;
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-application', () => ({
  nativeApplicationVersion: null,
  nativeBuildVersion: null,
}));

jest.mock('expo-device', () => ({ osVersion: null, modelName: null }));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
}));

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(() => Promise.resolve()) }));

// MA11 native modules: no JS-side implementation under jest.
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-share-intent', () => ({
  ShareIntentProvider: ({ children }: { children: unknown }) => children,
  useShareIntentContext: () => ({
    hasShareIntent: false,
    shareIntent: { files: null },
    resetShareIntent: jest.fn(),
  }),
}));

// MA12: native modules with no JS-side implementation under jest.
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));

// MA24: push native modules have no JS-side implementation under jest.
jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  AndroidImportance: { HIGH: 6 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
}));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(() => Promise.resolve('fcm-token')),
  deleteToken: jest.fn(() => Promise.resolve()),
  onTokenRefresh: jest.fn(() => jest.fn()),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  setBackgroundMessageHandler: jest.fn(),
}));
