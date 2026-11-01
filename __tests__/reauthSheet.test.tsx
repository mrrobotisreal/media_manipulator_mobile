import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import * as FB from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { i18n } from '@/i18n';
import { ReauthSheet } from '@/auth/ui/ReauthSheet';

jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));

function userWith(...providerIds: string[]) {
  return { email: 'a@b.co', providerData: providerIds.map((providerId) => ({ providerId })) };
}

async function mount(providers: string[], onDone = jest.fn()) {
  const user = userWith(...providers);
  (FB.getAuth as jest.Mock).mockReturnValue({ currentUser: user });
  await render(
    <I18nextProvider i18n={i18n}>
      <ReauthSheet visible onClose={jest.fn()} onDone={onDone} />
    </I18nextProvider>,
  );
  return { user, onDone };
}

process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';

describe('ReauthSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FB.getIdToken as jest.Mock).mockResolvedValue('fresh');
    (FB.reauthenticateWithCredential as jest.Mock).mockResolvedValue({});
  });

  it('offers only the password method for a password user', async () => {
    await mount(['password']);
    expect(screen.getByText('Confirm with password')).toBeTruthy();
    expect(screen.queryByText('Confirm with Google')).toBeNull();
    expect(screen.queryByText('Confirm with Apple')).toBeNull();
  });

  it('offers only Google for a Google user', async () => {
    await mount(['google.com']);
    expect(screen.getByText('Confirm with Google')).toBeTruthy();
    expect(screen.queryByText('Confirm with password')).toBeNull();
    expect(screen.queryByText('Confirm with Apple')).toBeNull();
  });

  it('offers only Apple for an Apple user', async () => {
    await mount(['apple.com']);
    expect(screen.getByText('Confirm with Apple')).toBeTruthy();
    expect(screen.queryByText('Confirm with password')).toBeNull();
    expect(screen.queryByText('Confirm with Google')).toBeNull();
  });

  it('shows the localized neutral error for a wrong password and does not resolve', async () => {
    const { onDone } = await mount(['password']);
    (FB.reauthenticateWithCredential as jest.Mock).mockRejectedValue({
      code: 'auth/wrong-password',
    });
    await fireEvent.changeText(screen.getByLabelText('Password'), 'nope');
    await fireEvent.press(screen.getByText('Confirm with password'));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect.')).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
  });

  it('resolves the caller with the fresh token on success (password)', async () => {
    const { onDone } = await mount(['password']);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'right-pass');
    await fireEvent.press(screen.getByText('Confirm with password'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('fresh'));
    expect(FB.EmailAuthProvider.credential).toHaveBeenCalledWith('a@b.co', 'right-pass');
  });

  it('resolves the caller after a Google re-auth', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
      type: 'success',
      data: { idToken: 't' },
    });
    const { onDone } = await mount(['google.com']);
    await fireEvent.press(screen.getByText('Confirm with Google'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('fresh'));
  });

  it('stays silent when the user cancels the Google sheet', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled', data: null });
    const { onDone } = await mount(['google.com']);
    await fireEvent.press(screen.getByText('Confirm with Google'));
    await waitFor(() => expect(GoogleSignin.signIn).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });
});
