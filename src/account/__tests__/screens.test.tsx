import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import NotificationsScreen from '../../../app/(app)/(tabs)/account/notifications';
import PrivacyScreen from '../../../app/(app)/(tabs)/account/privacy';
import { accountSettingsApi } from '@/api/endpoints/accountSettings';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

jest.mock('@/analytics/track', () => ({
  track: jest.fn(),
  reset: jest.fn(),
  discardQueuedEvents: jest.fn(),
  flushEvents: jest.fn(),
}));
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('@/files/saveDeps', () => ({ realSaveDeps: () => ({}) }));
jest.mock('@/account/realDeps', () => ({
  realOptOutDeps: () => {
    const { store } = jest.requireMock('@/state/store') as never as {
      store: { dispatch: (a: unknown) => void };
    };
    void store;
    return {
      setOptOut: (v: boolean) => mockSetOptOut(v),
      visitorId: () => 'v',
      fetch: () => mockFetch(),
      analyticsBaseUrl: 'https://an.test',
    };
  },
  realDsrDeps: () => ({}),
  realDeleteFilesDeps: () => ({}),
}));
const mockAskForPush = jest.fn(async (_d: unknown, _s: string) => false);
jest.mock('@/push/promptFlow', () => ({
  askForPush: (d: unknown, s: string) => mockAskForPush(d, s),
}));
const mockSetOptOut = jest.fn();
const mockFetch = jest.fn(() => Promise.resolve({ ok: true, status: 202 }));

const base = {
  retentionHours: 4320,
  retentionScope: 'all',
  deleteMetadataReports: false,
  historyVisibility: 'full' as const,
  emailAiJobFinished: false,
  emailExpiryDigest: true,
  updatedAt: '2026-11-01T00:00:00Z',
  limits: { minHours: 24, maxHours: 17520, defaultHours: 4320 },
};

async function mount(ui: React.ReactElement, settings?: Record<string, unknown>) {
  const { store } = await makeReadyStore();
  if (settings)
    await store.dispatch(
      accountSettingsApi.util.upsertQueryData('getSettings', undefined, settings as never),
    );
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
  return store;
}

describe('notifications screen', () => {
  it('notifications screen hides the push row when pushJobFinished is absent', async () => {
    await mount(<NotificationsScreen />, base);
    expect(screen.getByText('Email me when a long AI job finishes')).toBeTruthy();
    expect(screen.getByText('Email me before saved files expire')).toBeTruthy();
    expect(screen.queryByText('Push notification when a long job finishes')).toBeNull();
    expect(screen.queryByTestId('push-card')).toBeNull();
  });

  it('shows and binds the push row when the API sends the field', async () => {
    await mount(<NotificationsScreen />, { ...base, pushJobFinished: true });
    const sw = screen.getByLabelText('Push notification when a long job finishes');
    expect(sw.props.value).toBe(true);
  });
});

describe('notifications screen: OS permission (MA24)', () => {
  const pushOn = { ...base, pushJobFinished: true };
  const setOs = (status: string) =>
    // A refusal is `denied` that cannot ask again; a never-asked Android 13+ permission is `denied` + canAskAgain.
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status,
      canAskAgain: status !== 'denied',
    });

  it('notifications row disables the switch when OS permission is denied', async () => {
    setOs('denied');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await mount(<NotificationsScreen />, pushOn);
    await waitFor(() => expect(screen.getByTestId('push-os-denied')).toBeTruthy());
    expect(screen.getByText('Notifications are off for Media Manipulator')).toBeTruthy();
    const sw = screen.getByLabelText('Push notification when a long job finishes');
    expect(sw.props.disabled).toBe(true);
    expect(sw.props.value).toBe(false);
    await fireEvent.press(screen.getByText('Open settings'));
    expect(open).toHaveBeenCalled();
  });

  it('shows the plain switch (no settings link) when the OS permission is granted', async () => {
    setOs('granted');
    await mount(<NotificationsScreen />, pushOn);
    await waitFor(() =>
      expect(screen.getByLabelText('Push notification when a long job finishes')).toBeTruthy(),
    );
    expect(screen.queryByTestId('push-os-denied')).toBeNull();
    expect(screen.getByLabelText('Push notification when a long job finishes').props.value).toBe(
      true,
    );
  });

  it('undetermined: turning it on runs the pre-prompt with surface settings', async () => {
    setOs('undetermined');
    const store = await mount(<NotificationsScreen />, { ...base, pushJobFinished: false });
    void store;
    await fireEvent(
      screen.getByLabelText('Push notification when a long job finishes'),
      'valueChange',
      true,
    );
    await waitFor(() => expect(mockAskForPush).toHaveBeenCalledWith(expect.anything(), 'settings'));
  });
});

describe('privacy screen', () => {
  it('moves the analytics opt-out switch here and records the choice', async () => {
    await mount(<PrivacyScreen />);
    expect(screen.getByText('Share usage analytics')).toBeTruthy();
    const toggle = screen.getByLabelText('Share usage analytics');
    expect(toggle.props.value).toBe(true);
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() => expect(mockSetOptOut).toHaveBeenCalledWith(true));
    // the consent record was posted (fire-and-forget); the DSR delete is a separate button
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('delete-all needs the typed phrase DELETE', async () => {
    await mount(<PrivacyScreen />);
    await fireEvent.press(screen.getAllByText('Delete all my files').pop()!);
    const input = screen.getByLabelText('Type DELETE to confirm');
    const confirm = () => screen.getAllByRole('button', { name: 'Delete all my files' }).pop()!;
    expect(confirm().props.accessibilityState?.disabled ?? confirm().props['aria-disabled']).toBe(
      true,
    );
    await fireEvent.changeText(input, 'delete');
    expect(confirm().props.accessibilityState?.disabled ?? confirm().props['aria-disabled']).toBe(
      true,
    );
    await fireEvent.changeText(input, 'DELETE');
    expect(
      confirm().props.accessibilityState?.disabled ?? confirm().props['aria-disabled'],
    ).toBeFalsy();
  });
});
