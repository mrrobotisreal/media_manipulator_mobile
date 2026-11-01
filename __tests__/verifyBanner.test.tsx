import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import * as FB from '@react-native-firebase/auth';
import { i18n } from '@/i18n';
import ToolsTab from '../app/(app)/(tabs)/index';
import { makeReadyStore } from '@/state/testing';
import { identityChanged, statusChanged } from '@/state/slices/auth';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));

const identity = (over: Partial<Parameters<typeof identityChanged>[0] & object> = {}) => ({
  uid: 'u1',
  email: 'a@b.co',
  displayName: 'A',
  providerIds: ['password'],
  emailVerified: false,
  ...over,
});

let appStateHandler: ((s: string) => void) | null = null;

async function renderTools(id: ReturnType<typeof identity>, firebaseUser?: object) {
  (FB.getAuth as jest.Mock).mockReturnValue({ currentUser: firebaseUser ?? null });
  const { store } = await makeReadyStore();
  store.dispatch(statusChanged('ready'));
  store.dispatch(identityChanged(id));
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ToolsTab />
      </I18nextProvider>
    </Provider>,
  );
  return store;
}

describe('verify-email banner on the Tools tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appStateHandler = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      handler: (s: string) => void,
    ) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows for an unverified email/password user', async () => {
    await renderTools(identity());
    expect(screen.getByText('Verify your email to keep your account secure.')).toBeTruthy();
    expect(screen.getByText('Send link')).toBeTruthy();
  });

  it('is hidden for a verified user', async () => {
    await renderTools(identity({ emailVerified: true }));
    expect(screen.queryByText('Send link')).toBeNull();
  });

  it('is hidden for an unverified Google user', async () => {
    await renderTools(identity({ providerIds: ['google.com'] }));
    expect(screen.queryByText('Send link')).toBeNull();
  });

  it('Send link calls sendEmailVerification once and confirms', async () => {
    const user = { uid: 'u1' };
    (FB.sendEmailVerification as jest.Mock).mockResolvedValue(undefined);
    await renderTools(identity(), user);
    await fireEvent.press(screen.getByText('Send link'));
    await waitFor(() => expect(screen.getByText('Link sent. Check your inbox.')).toBeTruthy());
    expect(FB.sendEmailVerification).toHaveBeenCalledTimes(1);
    expect(FB.sendEmailVerification).toHaveBeenCalledWith(user);
    expect(screen.queryByText('Send link')).toBeNull();
  });

  it('clears after a foreground reload reports emailVerified', async () => {
    const user: {
      uid: string;
      email: string;
      displayName: string;
      emailVerified: boolean;
      providerData: object[];
    } = {
      uid: 'u1',
      email: 'a@b.co',
      displayName: 'A',
      emailVerified: false,
      providerData: [{ providerId: 'password' }],
    };
    (FB.reload as jest.Mock).mockImplementation(async () => {
      user.emailVerified = true;
    });
    (FB.getIdToken as jest.Mock).mockResolvedValue('tok');
    const store = await renderTools(identity(), user);
    expect(screen.getByText('Send link')).toBeTruthy();

    await act(async () => {
      appStateHandler?.('active');
    });
    await waitFor(() => expect(store.getState().auth.emailVerified).toBe(true));
    expect(FB.reload).toHaveBeenCalledWith(user);
    expect(screen.queryByText('Send link')).toBeNull();
  });
});
