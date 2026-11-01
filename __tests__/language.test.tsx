import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import LanguageScreen from '../app/(app)/language';
import { i18n } from '@/i18n';
import { locales } from '@/i18n/locales';
import { persistor, store } from '@/state/store';

jest.mock('lucide-react-native', () => ({
  Check: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
}));

jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

describe('language picker', () => {
  it('lists System default plus the 18 locales and persists a same-direction override', async () => {
    await persistor.flush();
    await render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <LanguageScreen />
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(19);
    expect(screen.getByText('System default')).toBeTruthy();
    for (const l of locales)
      expect(screen.getAllByText(l.label, { exact: true }).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText('Deutsch'));
    expect(store.getState().settings.locale).toBe('de-DE');
    expect(i18n.language).toBe('de-DE');
    await i18n.changeLanguage('en-US');
  });
});
