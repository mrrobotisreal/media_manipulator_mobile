import { render, screen } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import AppLayout from '../app/(app)/_layout';
import { statusChanged, type AuthStatus } from '@/state/slices/auth';
import { makeReadyStore } from '@/state/testing';

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
    Stack: () => <Text testID="stack">stack</Text>,
  };
});

async function renderWith(status: AuthStatus) {
  const { store } = await makeReadyStore();
  store.dispatch(statusChanged(status));
  await render(
    <Provider store={store}>
      <AppLayout />
    </Provider>,
  );
}

describe('(app) gating', () => {
  it.each<AuthStatus>(['unknown', 'signedOut', 'syncing'])(
    'redirects to sign-in when %s',
    async (status) => {
      await renderWith(status);
      expect(screen.getByTestId('redirect').props.children).toBe('/(auth)/sign-in');
    },
  );

  it('goes to the sync-failed screen when the sync failed', async () => {
    await renderWith('syncFailed');
    expect(screen.getByTestId('redirect').props.children).toBe('/(auth)/sync-failed');
  });

  it('renders the app when ready', async () => {
    await renderWith('ready');
    expect(screen.getByTestId('stack')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
  });
});
