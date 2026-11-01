import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { appVersionString, resetUserAgentCache, userAgent } from './userAgent';

const app = Application as {
  nativeApplicationVersion: string | null;
  nativeBuildVersion: string | null;
};
const device = Device as { osVersion: string | null; modelName: string | null };

describe('userAgent', () => {
  beforeEach(resetUserAgentCache);

  it('falls back to 0.0.0+0 / unknown under Jest', () => {
    expect(appVersionString()).toBe('0.0.0+0');
    expect(userAgent()).toMatch(
      /^MediaManipulator\/0\.0\.0\+0 \((Android|iOS) unknown; unknown\)$/,
    );
  });

  it('formats version, build, os and model', () => {
    app.nativeApplicationVersion = '1.2.3';
    app.nativeBuildVersion = '45';
    device.osVersion = '15';
    device.modelName = 'SM-S928U';
    expect(userAgent()).toMatch(/^MediaManipulator\/1\.2\.3\+45 \((Android|iOS) 15; SM-S928U\)$/);
    app.nativeApplicationVersion = null;
    app.nativeBuildVersion = null;
    device.osVersion = null;
    device.modelName = null;
  });

  it('never contains okhttp', () => {
    expect(userAgent().toLowerCase()).not.toContain('okhttp');
  });
});
