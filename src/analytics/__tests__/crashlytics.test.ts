import { appVariant } from '@/lib/appVariant';
import {
  crashlyticsIdentify,
  crashlyticsRecord,
  crashlyticsReset,
  initCrashlytics,
  resetCrashlyticsForTests,
} from '../crashlytics';

// jest.mock calls are hoisted above the imports, so the mock is in place first.
const mockFns = {
  getCrashlytics: jest.fn(() => ({ id: 'c' })),
  setCrashlyticsCollectionEnabled: jest.fn(() => Promise.resolve()),
  setUserId: jest.fn(() => Promise.resolve(null)),
  setAttributes: jest.fn(() => Promise.resolve(null)),
  recordError: jest.fn(),
};
jest.mock('@react-native-firebase/crashlytics', () => mockFns);
let mockConfigured = true;
jest.mock('@/lib/firebaseAvailable', () => ({ isFirebaseConfigured: () => mockConfigured }));


describe('crashlytics', () => {
  beforeEach(() => {
    resetCrashlyticsForTests();
    mockConfigured = true;
    Object.values(mockFns).forEach((f) => f.mockClear());
  });

  it('collection disabled for the development variant, enabled for preview and production', () => {
    initCrashlytics('development');
    initCrashlytics('preview');
    initCrashlytics('production');
    expect(
      mockFns.setCrashlyticsCollectionEnabled.mock.calls.map((c) => (c as unknown[])[1]),
    ).toEqual([false, true, true]);
  });

  it('variant from the installed application id', () => {
    expect(appVariant('com.mediamanipulator.app.dev')).toBe('development');
    expect(appVariant('com.mediamanipulator.app.preview')).toBe('preview');
    expect(appVariant('com.mediamanipulator.app')).toBe('production');
    expect(appVariant(null)).toBe('development');
  });

  it('user id + attributes on ready; cleared on sign-out', () => {
    crashlyticsIdentify('uid-1', { tier: 'pro', locale: 'en-US', app_version: '1.0.0+3' });
    expect(mockFns.setUserId).toHaveBeenLastCalledWith({ id: 'c' }, 'uid-1');
    expect(mockFns.setAttributes).toHaveBeenLastCalledWith(
      { id: 'c' },
      { tier: 'pro', locale: 'en-US', app_version: '1.0.0+3' },
    );
    crashlyticsReset();
    expect(mockFns.setUserId).toHaveBeenLastCalledWith({ id: 'c' }, '');
  });

  it('records non-fatal JS errors', () => {
    crashlyticsRecord('plain');
    expect(mockFns.recordError).toHaveBeenCalledWith({ id: 'c' }, expect.any(Error), undefined);
  });

  it('no Firebase config file: nothing touches the native module', () => {
    mockConfigured = false;
    expect(initCrashlytics('production')).toBe(false);
    crashlyticsIdentify('u', { tier: 'free', locale: 'en-US', app_version: '1' });
    expect(mockFns.getCrashlytics).not.toHaveBeenCalled();
  });

  it('the client wires identify/reset to Crashlytics (runtime deps)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildClientDeps } = require('../runtime') as typeof import('../runtime');
    const d = buildClientDeps();
    d.onIdentify!('uid-2', 'free');
    expect(mockFns.setUserId).toHaveBeenLastCalledWith({ id: 'c' }, 'uid-2');
    expect(mockFns.setAttributes).toHaveBeenLastCalledWith(
      { id: 'c' },
      expect.objectContaining({ tier: 'free', locale: 'en-US' }),
    );
    d.onReset!();
    expect(mockFns.setUserId).toHaveBeenLastCalledWith({ id: 'c' }, '');
  });
});
