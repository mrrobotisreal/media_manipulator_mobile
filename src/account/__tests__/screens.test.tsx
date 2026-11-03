import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import NotificationsScreen from '../../../app/(app)/(tabs)/account/notifications';
import PrivacyScreen from '../../../app/(app)/(tabs)/account/privacy';
import { accountSettingsApi } from '@/api/endpoints/accountSettings';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';

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
