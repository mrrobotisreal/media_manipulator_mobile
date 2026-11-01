import fs from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Set by Mitch in MA01 phase B (eas init).
const EAS_PROJECT_ID = '';
const EAS_OWNER: string | undefined = undefined;

export type Variant = 'development' | 'preview' | 'production';

// Single source for the store ids; variants add a suffix. (decided by Mitch 2026-11-01; matches Firebase and App Store Connect)
export const ANDROID_PACKAGE = 'com.mediamanipulator.app';
export const IOS_BUNDLE_ID = 'com.mediamanipulator.app';

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
        android: { minSdkVersion: 26 },
        // Static frameworks are react-native-firebase's iOS requirement.
        ios: { deploymentTarget: '16.4', useFrameworks: 'static' },
      },
    ],
  ];
  if (hasAndroidFirebase || hasIosFirebase) plugins.push('@react-native-firebase/app');

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
