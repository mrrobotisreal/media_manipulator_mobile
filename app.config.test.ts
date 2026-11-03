import path from 'node:path';
import { PUSH_CHANNEL_ID, ANDROID_PACKAGE, IOS_BUNDLE_ID, buildConfig } from './app.config';

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
    expect(c.updates).toEqual({ url: 'https://u.expo.dev/f8644b0d-44d2-4a4f-bec9-0b0cc4252f14' });
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
});
