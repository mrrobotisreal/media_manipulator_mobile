import { GoogleAuthProvider } from '@react-native-firebase/auth';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { getGoogleCredential } from '../google';

const signIn = GoogleSignin.signIn as jest.Mock;

describe('google', () => {
  beforeEach(() => jest.clearAllMocks());

  it('turns the id token into a Firebase credential', async () => {
    signIn.mockResolvedValue({ type: 'success', data: { idToken: 'tok' } });
    const cred = await getGoogleCredential();
    expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });
    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('tok');
    expect(cred).toEqual({ providerId: 'google.com', token: 'tok' });
  });

  it('cancelled response is silent (null)', async () => {
    signIn.mockResolvedValue({ type: 'cancelled', data: null });
    expect(await getGoogleCredential()).toBeNull();
  });

  it('SIGN_IN_CANCELLED rejection is silent (null)', async () => {
    signIn.mockRejectedValue({ code: statusCodes.SIGN_IN_CANCELLED });
    expect(await getGoogleCredential()).toBeNull();
  });

  it('other failures propagate', async () => {
    signIn.mockRejectedValue({ code: '10' });
    await expect(getGoogleCredential()).rejects.toEqual({ code: '10' });
  });
});
