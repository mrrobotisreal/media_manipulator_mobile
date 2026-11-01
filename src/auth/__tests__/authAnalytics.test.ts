import { track } from '@/analytics/track';
import { authErrorCode } from '../errors';
import {
  setAuthEntrySource,
  trackAuthFailed,
  trackAuthScreenShown,
  trackAuthSuccess,
  trackPasswordResetRequested,
  trackSignupStarted,
} from '../analytics';

jest.mock('@/analytics/track', () => ({ track: jest.fn(), identify: jest.fn(), reset: jest.fn() }));

describe('auth analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits the catalog names with method/stage/reason only', () => {
    setAuthEntrySource('session_expired');
    trackAuthScreenShown('signin');
    trackSignupStarted('google');
    trackAuthSuccess('google', true);
    trackAuthSuccess('email', false);
    trackAuthFailed('email', 'credential', {
      code: 'auth/wrong-password',
      message: 'a@b.co is wrong',
    });
    trackPasswordResetRequested();
    expect((track as jest.Mock).mock.calls).toEqual([
      ['auth_modal_opened', { source: 'session_expired', mode: 'signin' }],
      ['signup_started', { method: 'google' }],
      ['signup_completed', { method: 'google' }],
      ['signin_completed', { method: 'email' }],
      ['auth_failed', { method: 'email', stage: 'credential', reason: 'auth/wrong-password' }],
      ['password_reset_requested', { surface: 'app' }],
    ]);
  });

  it('no event carries email, name or message keys', () => {
    trackAuthFailed('apple', 'provider', {
      code: 'x',
      message: 'secret@x.co',
      email: 'secret@x.co',
    });
    const props = JSON.stringify((track as jest.Mock).mock.calls);
    expect(props).not.toMatch(/secret|email"|name"|message/);
    expect(authErrorCode({ message: 'only a message' })).toBe('unknown');
  });
});
