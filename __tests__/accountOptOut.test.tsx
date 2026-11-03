import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import AccountTab from '../app/(app)/(tabs)/account';
import { i18n } from '@/i18n';
import { persistor, store } from '@/state/store';

jest.mock('lucide-react-native', () => ({
  ChevronLeft: () => null,
  ChevronRight: () => null,
  CircleUser: () => null,
  Languages: () => null,
}));
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

describe('Account tab: Share usage analytics', () => {
  it('is on by default and toggles settings.analyticsOptOut', async () => {
    await persistor.flush();
    await render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <AccountTab />
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByText('Share usage analytics')).toBeTruthy();
    expect(
      screen.getByText('Helps us improve the app. No file names or contents are ever sent.'),
    ).toBeTruthy();
    const toggle = screen.getByLabelText('Share usage analytics');
    expect(toggle.props.value).toBe(true);
    await fireEvent(toggle, 'valueChange', false);
    expect(store.getState().settings.analyticsOptOut).toBe(true);
    await fireEvent(screen.getByLabelText('Share usage analytics'), 'valueChange', true);
    expect(store.getState().settings.analyticsOptOut).toBe(false);
  });
});
