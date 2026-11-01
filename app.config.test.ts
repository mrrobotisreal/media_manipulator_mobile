import path from 'node:path';
import { ANDROID_PACKAGE, IOS_BUNDLE_ID, buildConfig } from './app.config';

const none = () => false;
const fixture = path.join(__dirname, '__fixtures__', 'google-services.fixture.json');

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
    expect(c.updates).toBeUndefined();
  });

  it('defaults to development', () => {
    expect(buildConfig({}, none).android?.package).toBe(`${ANDROID_PACKAGE}.dev`);
  });

  it('omits the Firebase plugin when the file is missing', () => {
    const c = buildConfig({}, none);
    expect(c.plugins).not.toContain('@react-native-firebase/app');
    expect(c.android?.googleServicesFile).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('includes the Firebase plugin when GOOGLE_SERVICES_JSON points at a fixture', () => {
    const c = buildConfig({ GOOGLE_SERVICES_JSON: fixture });
    expect(c.plugins).toContain('@react-native-firebase/app');
    expect(c.android?.googleServicesFile).toBe(fixture);
  });
});
