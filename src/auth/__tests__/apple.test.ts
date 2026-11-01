import { appleAuth } from '@invertase/react-native-apple-authentication';
import * as FB from '@react-native-firebase/auth';
import { Platform } from 'react-native';
import { getAppleNativeCredential, signInWithAppleAndroid } from '../apple';

const perform = appleAuth.performRequest as jest.Mock;

describe('apple', () => {
  beforeEach(() => jest.clearAllMocks());

  it('iOS: sends a 64-char hex raw nonce and builds the credential with the returned raw nonce', async () => {
    perform.mockResolvedValue({
      identityToken: 'idt',
      nonce: 'rawnonce',
      fullName: { givenName: 'Ada', familyName: 'Lovelace' },
    });
    const out = await getAppleNativeCredential();
    const sent = perform.mock.calls[0][0];
    expect(sent.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.requestedScopes).toHaveLength(2);
    expect(out?.credential).toMatchObject({
      providerId: 'apple.com',
      idToken: 'idt',
      rawNonce: 'rawnonce',
    });
    expect(out?.displayName).toBe('Ada Lovelace');
  });

  it('iOS: cancel is silent', async () => {
    perform.mockRejectedValue({ code: '1001' });
    expect(await getAppleNativeCredential()).toBeNull();
  });

  it('Android: signs in through the Firebase provider flow with email + name scopes', async () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    (FB.signInWithPopup as jest.Mock).mockResolvedValue({
      user: { displayName: null },
      additionalUserInfo: { profile: { name: { firstName: 'Ada', lastName: 'L' } } },
    });
    const { displayName } = await signInWithAppleAndroid();
    const provider = (FB.signInWithPopup as jest.Mock).mock.calls[0][1];
    expect(provider.providerId).toBe('apple.com');
    expect(provider.scopes).toEqual(['email', 'name']);
    expect(displayName).toBe('Ada L');
    Platform.OS = original;
  });
});
