import fs from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Set by Mitch in MA01 phase B (eas init).
const EAS_PROJECT_ID = '';
const EAS_OWNER: string | undefined = undefined;

export type Variant = 'development' | 'preview' | 'production';

// Single source for the store ids; variants add a suffix. (decided by Mitch 2026-11-01; matches Firebase and App Store Connect)
export const ANDROID_PACKAGE = 'com.mediamanipulator.app';
export const IOS_BUNDLE_ID = 'com.mediamanipulator.app';

// The system Photo Picker / Storage Access Framework need none of these; keep them out of the merged manifest.
export const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_EXTERNAL_STORAGE',
  // WRITE_EXTERNAL_STORAGE is NOT blocked: MediaStore inserts on Android 8-9 (minSdk 26) need it. It is
  // capped to API <= 28 by `withWriteStorageMaxSdk28` below, so it is absent on Android 10+ (MA14).
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
];

const BACKGROUND = '#0A0B0D';

const VARIANTS: Record<Variant, { name: string; scheme: string; suffix: string }> = {
  production: { name: 'MediaManip', scheme: 'mediamanipulator', suffix: '' },
  preview: { name: 'MediaManip Preview', scheme: 'mediamanipulator-preview', suffix: '.preview' },
  development: { name: 'MediaManip Dev', scheme: 'mediamanipulator-dev', suffix: '.dev' },
};

export function resolveVariant(value: string | undefined): Variant {
  return value === 'preview' || value === 'production' ? value : 'development';
}

export function buildConfig(
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = fs.existsSync,
): ExpoConfig {
  const variant = resolveVariant(env.APP_VARIANT);
  const v = VARIANTS[variant];
  const googleServicesFile = env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const googleServiceInfoPlist = env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist';
  const hasAndroidFirebase = exists(googleServicesFile);
  const hasIosFirebase = exists(googleServiceInfoPlist);
  if (!hasAndroidFirebase && !hasIosFirebase) {
    console.warn('Firebase config not found; building without Firebase');
  }

  const plugins: NonNullable<ExpoConfig['plugins']> = [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', backgroundColor: BACKGROUND, imageWidth: 200 },
    ],
    [
      'expo-build-properties',
      {
        // Kotlin 2.3.20: @react-native-firebase 27's firebase-auth 25 ships Kotlin 2.4 metadata, which
        // a 2.3 compiler reads (one minor ahead) but RN 0.86's default 2.1 cannot. Not 2.4: Expo 57's
        // pika compiler plugin is published up to 2.3.20. Pinned on the root classpath by
        // plugins/withKotlinGradlePlugin.
        android: { minSdkVersion: 26, kotlinVersion: '2.3.20' },
        // Static frameworks are react-native-firebase's iOS requirement.
        ios: { deploymentTarget: '16.4', useFrameworks: 'static' },
      },
    ],
    // File intake (MA11). System pickers need no storage permissions (ARCHITECTURE section 11).
    [
      'expo-image-picker',
      { photosPermission: false, cameraPermission: false, microphonePermission: false },
    ],
    'expo-document-picker',
    // Result PDF open on iOS and MA14 Share (MA13).
    'expo-sharing',
    // Registered BEFORE expo-media-library: Expo runs later plugins' manifest mods first, so this one sees
    // the plugin's output. Caps WRITE_EXTERNAL_STORAGE to API <= 28 and drops requestLegacyExternalStorage.
    './plugins/withWriteStorageMaxSdk28',
    // Root Kotlin Gradle plugin follows android.kotlinVersion (see the plugin header).
    './plugins/withKotlinGradlePlugin',
    // Save to Photos (MA14): add-only. No READ_MEDIA_* (granularPermissions: []), no media-location, and the
    // legacy storage permissions are blocked or capped to API <= 28 (ARCHITECTURE section 11).
    [
      'expo-media-library',
      {
        savePhotosPermission: 'Allow $(PRODUCT_NAME) to save your results to your photo library.',
        photosPermission: false,
        granularPermissions: [],
        isAccessMediaLocationEnabled: false,
      },
    ],
    'expo-video',
    [
      'expo-audio',
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false },
    ],
    // Android share-into only; the iOS share extension is MA36 (ADR MA-0002). The plugin's typed MIME list
    // has no audio/pdf, so `*/*` receives everything and src/files/share-intent.ts filters by MIME in JS.
    [
      'expo-share-intent',
      {
        disableIOS: true,
        androidIntentFilters: ['image/*', 'video/*', '*/*'],
        androidMultiIntentFilters: ['image/*', 'video/*', '*/*'],
      },
    ],
  ];
  // Auth plugins live inside the same guard: without a Firebase config file the native modules are not linked.
  // The google-signin plugin reads REVERSED_CLIENT_ID from the plist itself (no iosUrlScheme option needed).
  if (hasAndroidFirebase || hasIosFirebase) {
    plugins.push(
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      // Crash reporting (MA07, ADR MA-0004); runtime collection flag in src/analytics/crashlytics.ts.
      '@react-native-firebase/crashlytics',
      '@react-native-google-signin/google-signin',
    );
  }

  const config: ExpoConfig = {
    name: v.name,
    slug: 'media-manipulator',
    scheme: v.scheme,
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: BACKGROUND,
    icon: './assets/icon.png',
    runtimeVersion: { policy: 'fingerprint' },
    android: {
      blockedPermissions: BLOCKED_ANDROID_PERMISSIONS,
      package: `${ANDROID_PACKAGE}${v.suffix}`,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: BACKGROUND,
      },
      ...(hasAndroidFirebase ? { googleServicesFile } : {}),
    },
    ios: {
      bundleIdentifier: `${IOS_BUNDLE_ID}${v.suffix}`,
      supportsTablet: false,
      usesAppleSignIn: true,
      ...(hasIosFirebase ? { googleServicesFile: googleServiceInfoPlist } : {}),
    },
    experiments: { typedRoutes: true },
    plugins,
  };
  if (EAS_OWNER) config.owner = EAS_OWNER;
  if (EAS_PROJECT_ID) {
    config.updates = { url: `https://u.expo.dev/${EAS_PROJECT_ID}` };
    config.extra = { eas: { projectId: EAS_PROJECT_ID } };
  }
  return config;
}

export default (_ctx: ConfigContext): ExpoConfig => buildConfig();
