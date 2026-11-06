import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import ToolsTab from '../../../app/(app)/(tabs)/index';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { track } from '@/analytics/track';
import { MediButton } from '../ui/MediButton';
import { getMediUi, resetMediUiForTests } from '../mediUi';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/auth/ui/AuthBanners', () => ({ AuthBanners: () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn(), setContext: jest.fn() }));

const mockCaps = jest.fn();
jest.mock('@/api/endpoints/assistant', () => ({
  ...jest.requireActual('@/api/endpoints/assistant'),
  useGetAssistantCapabilitiesQuery: () => mockCaps(),
}));

const ON = { data: { enabled: true, guide: { enabled: true } } };
const OFF = { data: { enabled: false } };

async function mountTab() {
  const { store } = await makeReadyStore();
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ToolsTab />
        <MediButton />
      </I18nextProvider>
    </Provider>,
  );
}

async function search(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Search tools'), text);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

describe('Tools tab entry points (MA54 decision 1)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMediUiForTests();
    (track as jest.Mock).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('the Medi button opens the sheet with entry button when the guide is enabled', async () => {
    mockCaps.mockReturnValue(ON);
    await mountTab();
    await fireEvent.press(screen.getByTestId('medi-button'));
    expect(getMediUi()).toMatchObject({ open: true, entry: 'button', prefill: '' });
    expect(track).toHaveBeenCalledWith('assistant_opened', { surface: 'guide', entry: 'button' });
  });

  it('no button and no row when Medi is off for the caller', async () => {
    mockCaps.mockReturnValue(OFF);
    await mountTab();
    expect(screen.queryByTestId('medi-button')).toBeNull();
    await search('zzzqqq');
    expect(screen.getByText('No tools match “zzzqqq”.')).toBeTruthy();
    expect(screen.queryByTestId('ask-medi-row')).toBeNull();
  });

  it('a search with no hits offers "Not sure? Ask Medi" with the text prefilled', async () => {
    mockCaps.mockReturnValue(ON);
    await mountTab();
    expect(screen.queryByTestId('ask-medi-row')).toBeNull();
    await search('zzzqqq');
    await fireEvent.press(screen.getByTestId('ask-medi-row'));
    expect(screen.getByText('Not sure? Ask Medi')).toBeTruthy();
    expect(getMediUi()).toMatchObject({ open: true, entry: 'empty_search', prefill: 'zzzqqq' });
    expect(track).toHaveBeenCalledWith('assistant_opened', {
      surface: 'guide',
      entry: 'empty_search',
    });
  });

  it('a search with hits shows no Medi row', async () => {
    mockCaps.mockReturnValue(ON);
    await mountTab();
    await search('gif');
    expect(screen.getByText('Video to GIF')).toBeTruthy();
    expect(screen.queryByTestId('ask-medi-row')).toBeNull();
  });
});
