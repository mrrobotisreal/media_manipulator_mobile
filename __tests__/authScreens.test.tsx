import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { i18n } from '@/i18n';
import ForgotPassword from '../app/(auth)/forgot-password';
import SignIn from '../app/(auth)/sign-in';
import { makeReadyStore } from '@/state/testing';
import { statusChanged } from '@/state/slices/auth';
import * as FB from '@react-native-firebase/auth';

jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});
const mockConfigured = jest.fn();
jest.mock('@/lib/firebaseAvailable', () => ({ isFirebaseConfigured: () => mockConfigured() }));
jest.mock('@/analytics/track', () => ({ track: jest.fn(), identify: jest.fn(), reset: jest.fn() }));

async function renderScreen(ui: React.ReactElement) {
  const { store } = await makeReadyStore();
  store.dispatch(statusChanged('signedOut'));
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
}

describe('sign-in screen', () => {
  const OLD = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = OLD;
  });

  it('shows Apple, Google and the email entry when Firebase is configured', async () => {
    mockConfigured.mockReturnValue(true);
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';
    await renderScreen(<SignIn />);
    expect(screen.getByText('Continue with Apple')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText('Sign in with email')).toBeTruthy();
    expect(screen.getByText('Forgot password?')).toBeTruthy();
    // Google's G is next to its label on every platform (hidden from a11y: the label says it).
    expect(screen.getByTestId('google-g', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows the Apple logo on the Android Apple button (iOS uses the native AppleButton)', async () => {
    mockConfigured.mockReturnValue(true);
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';
    const { Platform } = jest.requireActual<typeof import('react-native')>('react-native');
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      await renderScreen(<SignIn />);
      expect(screen.getByTestId('apple-logo', { includeHiddenElements: true })).toBeTruthy();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });

  it('hides Google when the web client id is missing', async () => {
    mockConfigured.mockReturnValue(true);
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    await renderScreen(<SignIn />);
    expect(screen.queryByText('Continue with Google')).toBeNull();
  });

  it('shows the unavailable state and no buttons without Firebase', async () => {
    mockConfigured.mockReturnValue(false);
    await renderScreen(<SignIn />);
    expect(screen.getByTestId('auth-unavailable')).toBeTruthy();
    expect(screen.queryByText('Continue with Apple')).toBeNull();
    expect(screen.queryByText('Sign in with email')).toBeNull();
  });
});

describe('forgot-password screen', () => {
  it('ends in the neutral confirmation even for an unknown account', async () => {
    (FB.sendPasswordResetEmail as jest.Mock).mockRejectedValue({ code: 'auth/user-not-found' });
    await renderScreen(<ForgotPassword />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'nobody@example.com');
    await fireEvent.press(screen.getByText('Send reset link'));
    await waitFor(() => expect(screen.getByTestId('reset-sent')).toBeTruthy());
    expect(screen.getByText(/If an account exists for that email/)).toBeTruthy();
  });

  it('shows an inline error for a malformed email', async () => {
    await renderScreen(<ForgotPassword />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'nope');
    await fireEvent.press(screen.getByText('Send reset link'));
    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeTruthy());
  });
});
