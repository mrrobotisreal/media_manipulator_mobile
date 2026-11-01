import { appleAuth } from '@invertase/react-native-apple-authentication';
import * as FB from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import { availableReauthMethods, reauthenticate, ReauthCancelled } from '../reauth';

const user = {
  email: 'a@b.co',
  providerData: [{ providerId: 'password' }, { providerId: 'google.com' }, { providerId: 'phone' }],
};

describe('reauth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FB.getAuth as jest.Mock).mockReturnValue({ currentUser: user });
    (FB.getIdToken as jest.Mock).mockResolvedValue('fresh');
    (FB.reauthenticateWithCredential as jest.Mock).mockResolvedValue({});
  });

  it('lists methods from providerData, skipping unknown ones', () => {
    expect(availableReauthMethods()).toEqual(['email', 'google']);
  });

  it('password: EmailAuthProvider credential, then a forced token', async () => {
    expect(await reauthenticate({ kind: 'password', password: 'pw' })).toBe('fresh');
    expect(FB.EmailAuthProvider.credential).toHaveBeenCalledWith('a@b.co', 'pw');
    expect(FB.getIdToken).toHaveBeenCalledWith(user, true);
  });

  it('google: fresh sign-in credential', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
      type: 'success',
      data: { idToken: 't' },
    });
    expect(await reauthenticate({ kind: 'google' })).toBe('fresh');
    expect(FB.reauthenticateWithCredential).toHaveBeenCalledWith(user, {
      providerId: 'google.com',
      token: 't',
    });
  });

  it('google cancel throws ReauthCancelled', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled', data: null });
    await expect(reauthenticate({ kind: 'google' })).rejects.toBeInstanceOf(ReauthCancelled);
  });

  it('apple on Android: provider flow; on iOS: native credential', async () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    (FB.reauthenticateWithPopup as jest.Mock).mockResolvedValue({});
    expect(await reauthenticate({ kind: 'apple' })).toBe('fresh');
    expect((FB.reauthenticateWithPopup as jest.Mock).mock.calls[0][1].providerId).toBe('apple.com');

    Platform.OS = 'ios';
    (appleAuth.performRequest as jest.Mock).mockResolvedValue({
      identityToken: 'i',
      nonce: 'n',
      fullName: null,
    });
    expect(await reauthenticate({ kind: 'apple' })).toBe('fresh');
    expect(FB.reauthenticateWithCredential).toHaveBeenCalledTimes(1);
    Platform.OS = original;
  });
});
