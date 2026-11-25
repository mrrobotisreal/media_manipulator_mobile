import fs from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Set by Mitch in MA01 phase B (eas init).
const EAS_PROJECT_ID = 'f8644b0d-44d2-4a4f-bec9-0b0cc4252f14';
const EAS_OWNER: string | undefined = 'mwintrow';

export type Variant = 'development' | 'preview' | 'production';

// Single source for the store ids; variants add a suffix. (decided by Mitch 2026-11-01; matches Firebase and App Store Connect)
export const ANDROID_PACKAGE = 'com.mediamanipulator.app';
export const IOS_BUNDLE_ID = 'com.mediamanipulator.app';

// The system Photo Picker / Storage Access Framework need none of these; keep them out of the merged manifest.
/**
 * iOS `NSMicrophoneUsageDescription` per locale, from `locales/<dir>/app.json` `tools.voices.micPermission.iosUsage`
 * (all 18 locales, ticket MA34 decision 12), keyed by the lproj name iOS expects. Built at config time.
 * Nested under `ios`: Expo writes a locale's top-level keys to BOTH platforms, and Android's lint fails the
 * build on an iOS-only key in the values strings.xml files ("translated here but not found in default locale",
 * preview build 6, 2026-11-07).
 */
const LPROJ: Record<string, string> = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };

export function microphoneLocales(
  read: (p: string) => string = (p) => fs.readFileSync(p, 'utf8'),
  root: string = __dirname,
): Record<string, { ios: { NSMicrophoneUsageDescription: string } }> {
  const out: Record<string, { ios: { NSMicrophoneUsageDescription: string } }> = {};
  const codes = [
    'en-US',
    'uk-UA',
    'ru-RU',
    'he-IL',
    'de-DE',
    'es-ES',
    'es-MX',
    'fr-FR',
    'it-IT',
    'ja-JP',
    'zh-CN',
    'zh-TW',
    'ko-KR',
    'ar-SA',
    'hi-IN',
    'pt-PT',
    'pt-BR',
    'vi-VN',
  ];
  for (const code of codes) {
    try {
      const json = JSON.parse(read(`${root}/locales/${code.toLowerCase()}/app.json`)) as {
        tools?: { voices?: { micPermission?: { iosUsage?: string } } };
      };
      const text = json.tools?.voices?.micPermission?.iosUsage;
      if (text)
        out[
          LPROJ[code] ??
            (code.startsWith('pt') || code.startsWith('es-MX') ? code : code.split('-')[0]!)
        ] = { ios: { NSMicrophoneUsageDescription: text } };
    } catch {
      // a missing locale file just falls back to the English default
    }
  }
  return out;
}

export const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_EXTERNAL_STORAGE',
  // WRITE_EXTERNAL_STORAGE is NOT blocked: MediaStore inserts on Android 8-9 (minSdk 26) need it. It is
  // capped to API <= 28 by `withWriteStorageMaxSdk28` below, so it is absent on Android 10+ (MA14).
  'android.permission.CAMERA',
  // RECORD_AUDIO is NOT blocked since MA34: the Voices recorder (clone, change, shift) needs the microphone.
  // It is requested at runtime on the first Record tap only, and the expo-audio plugin below adds it.
];

export const APP_VERSION = '1.0.0';

/** iOS `NSMicrophoneUsageDescription` default (English); the per-locale strings live in `locales/<code>/infoplist.json`. */
export const MICROPHONE_USAGE =
  'Media Manipulator uses the microphone only when you record a voice sample or a recording to change.';

const BACKGROUND = '#0A0B0D';
const CORAL = '#FF6B4A';

/** Must equal `internal/push/fcm.go` `AndroidChannelID` and `src/push/channel.ts`. */
export const PUSH_CHANNEL_ID = 'job_updates';

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
      {
        image: './assets/splash-icon.png',
        backgroundColor: BACKGROUND,
        imageWidth: 160,
        dark: { image: './assets/splash-icon.png', backgroundColor: BACKGROUND },
      },
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
    // MA34: `microphonePermission` is the same string as expo-audio's, not `false`: `false` makes this plugin
    // BLOCK RECORD_AUDIO for the whole app (it would remove the Voices recorder's permission).
    [
      'expo-image-picker',
      { photosPermission: false, cameraPermission: false, microphonePermission: MICROPHONE_USAGE },
    ],
    'expo-document-picker',
    // Result PDF open on iOS and MA14 Share (MA13).
    'expo-sharing',
    // Registered BEFORE expo-media-library: Expo runs later plugins' manifest mods first, so this one sees
    // the plugin's output. Caps WRITE_EXTERNAL_STORAGE to API <= 28 and drops requestLegacyExternalStorage.
    './plugins/withWriteStorageMaxSdk28',
    // Root Kotlin Gradle plugin follows android.kotlinVersion (see the plugin header).
    './plugins/withKotlinGradlePlugin',
    // MA60: Gradle heap + Metaspace for the Skia 3 + WebGPU release build (lintVitalAnalyzeRelease
    // runs out of Metaspace on Expo's 512m default; see the plugin header).
    './plugins/withGradleJvmArgs',
    // MA60: react-native-webgpu's own plugin (minSdk >= 26, already ours; the iOS simulator's Metal
    // API validation off, which Dawn needs). react-native-skia 3 has no config plugin.
    'react-native-webgpu',
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
    // MA34: the voice recorder uses the microphone (Android RECORD_AUDIO, iOS NSMicrophoneUsageDescription;
    // the iOS string is localized per locale through `locales` below). Never a background recording, never
    // background playback: no foreground service, no UIBackgroundModes audio.
    [
      'expo-audio',
      {
        microphonePermission: MICROPHONE_USAGE,
        recordAudioAndroid: true,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
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
    // Push (MA24, decision 3): expo-notifications only creates the Android channel and asks the OS
    // permission (src/push); RN Firebase messaging owns the FCM token and message events. Unconditional:
    // it adds no Firebase dependency, and sets the iOS aps-environment entitlement + remote-notification
    // background mode (APNs key: MA35). The FCM default channel (`job_updates`, the one MA23 targets) is set
    // once, in firebase.json `messaging_android_notification_channel_id`: setting `defaultChannel` here too
    // makes the Android manifest merge fail (both libraries declare the same meta-data).
    [
      'expo-notifications',
      {
        mode: variant === 'production' ? 'production' : 'development',
        enableBackgroundRemoteNotifications: true,
        // Status-bar icon + accent for local and FCM notifications (white silhouette; @react-native-firebase/messaging's
        // plugin reads these two from here, so there is no second declaration).
        icon: './assets/notification-icon.png',
        color: CORAL,
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
      // Push (MA24): FCM token + message events. Linked only with a Firebase config, like auth.
      '@react-native-firebase/messaging',
      '@react-native-google-signin/google-signin',
    );
  }

  const config: ExpoConfig = {
    name: v.name,
    slug: 'media-manipulator',
    scheme: v.scheme,
    // User-visible semver; keep equal to package.json (scripts/bump-version.mjs edits both). The Android versionCode / iOS
    // buildNumber are remote-managed by EAS (eas.json appVersionSource: remote, autoIncrement).
    version: APP_VERSION,
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: BACKGROUND,
    icon: './assets/icon.png',
    runtimeVersion: { policy: 'fingerprint' },
    android: {
      blockedPermissions: BLOCKED_ANDROID_PERMISSIONS,
      // Android 13+ runtime notification permission (MA24; expo-notifications' manifest adds it too).
      permissions: ['android.permission.POST_NOTIFICATIONS'],
      package: `${ANDROID_PACKAGE}${v.suffix}`,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-foreground.png',
        monochromeImage: './assets/monochrome.png',
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
    locales: microphoneLocales(),
    experiments: { typedRoutes: true },
    plugins,
  };
  if (EAS_OWNER) config.owner = EAS_OWNER;
  if (EAS_PROJECT_ID) {
    // OTA (MA-0007): check on load, download in the background, apply on the next launch (never block the splash).
    config.updates = {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    };
    config.extra = { eas: { projectId: EAS_PROJECT_ID } };
  }
  return config;
}

export default (_ctx: ConfigContext): ExpoConfig => buildConfig();
