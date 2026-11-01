import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import * as FB from '@react-native-firebase/auth';
import AppLayout from '../../../app/(app)/_layout';
import { sessionExpired, statusChanged } from '@/state/slices/auth';
import { makeReadyStore } from '@/state/testing';

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
    Stack: () => <Text testID="stack">stack</Text>,
  };
});
jest.mock('@/analytics/track', () => ({ track: jest.fn(), identify: jest.fn(), reset: jest.fn() }));

describe('auth gate: sessionExpired', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FB.getAuth as jest.Mock).mockReturnValue({ currentUser: null });
  });

  it('signs out, flags the notice and lands on the sign-in route', async () => {
    const { store } = await makeReadyStore();
    store.dispatch(statusChanged('ready'));
    // Firebase's auth listener (syncGate) turns a completed sign-out into `signedOut`.
    (FB.signOut as jest.Mock).mockImplementation(async () => {
      act(() => {
        store.dispatch(statusChanged('signedOut'));
      });
    });
    await render(
      <Provider store={store}>
        <AppLayout />
      </Provider>,
    );
    expect(screen.getByTestId('stack')).toBeTruthy();

    store.dispatch(sessionExpired());

    await waitFor(() =>
      expect(screen.getByTestId('redirect').props.children).toBe('/(auth)/sign-in'),
    );
    expect(FB.signOut).toHaveBeenCalledTimes(1);
    expect(store.getState().auth.notice).toBe('sessionExpired');
  });

  it.each(['syncing', 'signedOut'] as const)('ignores a 401 while %s', async (status) => {
    const { store } = await makeReadyStore();
    store.dispatch(statusChanged(status));
    store.dispatch(sessionExpired());
    await new Promise((r) => setTimeout(r, 0));
    expect(FB.signOut).not.toHaveBeenCalled();
    expect(store.getState().auth.notice).toBeNull();
  });
});
