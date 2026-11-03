import fs from 'node:fs';
import path from 'node:path';
import {
  APP_VERSION,
  PUSH_CHANNEL_ID,
  ANDROID_PACKAGE,
  IOS_BUNDLE_ID,
  buildConfig,
} from './app.config';

const none = () => false;
const fixture = path.join(__dirname, '__fixtures__', 'firebase-android.fixture.json');

describe('app.config', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['production', 'MediaManip', 'mediamanipulator', ''],
    ['preview', 'MediaManip Preview', 'mediamanipulator-preview', '.preview'],
    ['development', 'MediaManip Dev', 'mediamanipulator-dev', '.dev'],
  ])('%s variant ids, name, scheme', (variant, name, scheme, suffix) => {
    const c = buildConfig({ APP_VARIANT: variant }, none);
    expect(c.name).toBe(name);
    expect(c.scheme).toBe(scheme);
    expect(c.android?.package).toBe(`${ANDROID_PACKAGE}${suffix}`);
    expect(c.ios?.bundleIdentifier).toBe(`${IOS_BUNDLE_ID}${suffix}`);
    expect(c.runtimeVersion).toEqual({ policy: 'fingerprint' });
    // EAS project linked (MA01): every variant shares the project, the update URL and the owner.
    expect(c.updates).toEqual({
      url: 'https://u.expo.dev/f8644b0d-44d2-4a4f-bec9-0b0cc4252f14',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    });
    expect(c.extra).toEqual({ eas: { projectId: 'f8644b0d-44d2-4a4f-bec9-0b0cc4252f14' } });
    expect(c.owner).toBe('mwintrow');
  });

  it('defaults to development', () => {
    expect(buildConfig({}, none).android?.package).toBe(`${ANDROID_PACKAGE}.dev`);
  });

  it('omits the Firebase plugin when the file is missing', () => {
    const c = buildConfig({}, none);
    expect(c.plugins).not.toContain('@react-native-firebase/app');
    expect(c.plugins).not.toContain('@react-native-firebase/auth');
    expect(c.plugins).not.toContain('@react-native-firebase/crashlytics');
    expect(c.plugins).not.toContain('@react-native-firebase/messaging');
    expect(c.plugins).not.toContain('@react-native-google-signin/google-signin');
    expect(c.android?.googleServicesFile).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('includes the Firebase plugin when GOOGLE_SERVICES_JSON points at a fixture', () => {
    const c = buildConfig({ GOOGLE_SERVICES_JSON: fixture });
    expect(c.plugins).toContain('@react-native-firebase/app');
    expect(c.plugins).toContain('@react-native-firebase/auth');
    expect(c.plugins).toContain('@react-native-firebase/crashlytics');
    expect(c.plugins).toContain('@react-native-firebase/messaging');
    expect(c.plugins).toContain('@react-native-google-signin/google-signin');
    expect(c.ios?.usesAppleSignIn).toBe(true);
    expect(c.android?.googleServicesFile).toBe(fixture);
  });

  it('configures Android-only share-into and blocks storage permissions', () => {
    const c = buildConfig({}, none);
    const share = (c.plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === 'expo-share-intent',
    ) as [string, Record<string, unknown>] | undefined;
    expect(share?.[1].disableIOS).toBe(true);
    expect(share?.[1].androidIntentFilters).toContain('*/*');
    expect(c.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE',
      ]),
    );
  });

  it('declares push: POST_NOTIFICATIONS and the job_updates default channel (MA24)', () => {
    const c = buildConfig({}, none);
    expect(c.android?.permissions).toContain('android.permission.POST_NOTIFICATIONS');
    expect(c.android?.blockedPermissions).not.toContain('android.permission.POST_NOTIFICATIONS');
    const n = (c.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as
      [string, Record<string, unknown>] | undefined;
    // One declaration of the FCM default channel: firebase.json (RNFB), never expo-notifications' defaultChannel,
    // or the manifest merge fails on duplicate meta-data.
    expect(n?.[1].defaultChannel).toBeUndefined();
    const fb = require('./firebase.json') as { 'react-native': Record<string, unknown> };
    expect(fb['react-native'].messaging_android_notification_channel_id).toBe(PUSH_CHANNEL_ID);
    expect(n?.[1].enableBackgroundRemoteNotifications).toBe(true);
    expect(buildConfig({ APP_VARIANT: 'production' }, none).plugins).toContainEqual([
      'expo-notifications',
      expect.objectContaining({ mode: 'production' }),
    ]);
  });

  it('app config uses the fingerprint runtime and the variant channel', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, 'eas.json'), 'utf8')) as {
      build: Record<
        'development' | 'preview' | 'production',
        { channel?: string; env?: { APP_VARIANT?: string } }
      >;
    };
    for (const variant of ['development', 'preview', 'production'] as const) {
      expect(buildConfig({ APP_VARIANT: variant }, none).runtimeVersion).toEqual({
        policy: 'fingerprint',
      });
      expect(eas.build[variant]?.channel).toBe(variant);
      expect(eas.build[variant]?.env?.APP_VARIANT).toBe(variant);
    }
  });

  it('production profile is a store app-bundle with autoIncrement', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, 'eas.json'), 'utf8')) as {
      cli: { appVersionSource: string };
      build: { production: Record<string, unknown>; preview: Record<string, unknown> };
      submit: { production: { android: { track: string; releaseStatus: string } } };
    };
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production).toMatchObject({
      distribution: 'store',
      autoIncrement: true,
      android: { buildType: 'app-bundle' },
    });
    // Preview APKs must upgrade in place; dev builds too.
    expect(eas.build.preview.autoIncrement).toBe(true);
    expect(eas.build.preview).toMatchObject({
      distribution: 'internal',
      android: { buildType: 'apk' },
    });
    expect(eas.submit.production.android).toEqual({ track: 'internal', releaseStatus: 'draft' });
  });

  it('android package ids per variant match MA-0002', () => {
    expect(buildConfig({ APP_VARIANT: 'production' }, none).android?.package).toBe(
      'com.mediamanipulator.app',
    );
    expect(buildConfig({ APP_VARIANT: 'preview' }, none).android?.package).toBe(
      'com.mediamanipulator.app.preview',
    );
    expect(buildConfig({ APP_VARIANT: 'development' }, none).android?.package).toBe(
      'com.mediamanipulator.app.dev',
    );
  });

  it('version equals package.json (bump-version keeps them in step)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(buildConfig({}, none).version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('wires the generated icons, splash and notification icon', () => {
    const c = buildConfig({}, none);
    expect(c.icon).toBe('./assets/icon.png');
    expect(c.android?.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-foreground.png',
      monochromeImage: './assets/monochrome.png',
      backgroundColor: '#0A0B0D',
    });
    const splash = (c.plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === 'expo-splash-screen',
    ) as [string, Record<string, unknown>] | undefined;
    expect(splash?.[1]).toMatchObject({ backgroundColor: '#0A0B0D', imageWidth: 160 });
    const n = (c.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as
      [string, Record<string, unknown>] | undefined;
    expect(n?.[1]).toMatchObject({ icon: './assets/notification-icon.png', color: '#FF6B4A' });
    for (const f of [
      'icon',
      'adaptive-foreground',
      'monochrome',
      'splash-icon',
      'notification-icon',
    ]) {
      expect(fs.existsSync(path.join(__dirname, 'assets', `${f}.png`))).toBe(true);
    }
  });
});
