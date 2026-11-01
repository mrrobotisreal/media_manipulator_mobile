import { authErrorCode, authErrorKey, errorEmail, isAccountExistsError } from '../errors';

const e = (code: string) => ({ code });

describe('authErrors', () => {
  it.each([
    ['auth/invalid-credential', 'invalidCredential'],
    ['auth/wrong-password', 'invalidCredential'],
    ['auth/user-not-found', 'invalidCredential'],
    ['auth/email-already-in-use', 'emailInUse'],
    ['auth/weak-password', 'weakPassword'],
    ['auth/invalid-email', 'invalidEmail'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/network-request-failed', 'network'],
    ['auth/something-new', 'generic'],
  ])('%s -> %s', (code, key) => {
    expect(authErrorKey(e(code))).toBe(key);
  });

  it('wrong-password and user-not-found share one key (no enumeration)', () => {
    expect(authErrorKey(e('auth/wrong-password'))).toBe(authErrorKey(e('auth/user-not-found')));
  });

  it('non-errors are generic with code unknown', () => {
    expect(authErrorKey(null)).toBe('generic');
    expect(authErrorCode('x')).toBe('unknown');
  });

  it('detects account-exists and reads the email', () => {
    const err = {
      code: 'auth/account-exists-with-different-credential',
      customData: { email: 'a@b.co' },
    };
    expect(isAccountExistsError(err)).toBe(true);
    expect(isAccountExistsError(e('auth/credential-already-in-use'))).toBe(true);
    expect(errorEmail(err)).toBe('a@b.co');
  });
});
