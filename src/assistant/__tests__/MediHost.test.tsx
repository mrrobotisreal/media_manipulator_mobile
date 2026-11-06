import { act, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { closeMedi, openMedi, resetMediUiForTests } from '../mediUi';
import { MediHost } from '../ui/MediHost';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/analytics/track', () => ({ track: jest.fn(), setContext: jest.fn() }));
jest.mock('@/api/endpoints/assistant', () => ({
  ...jest.requireActual('@/api/endpoints/assistant'),
  useListGuideConversationsQuery: () => ({
    isLoading: false,
    isError: false,
    data: [],
    refetch: jest.fn(),
  }),
}));

describe('MediHost', () => {
  beforeEach(() => resetMediUiForTests());

  it('renders nothing until Medi is first opened, then keeps the chat mounted across close', async () => {
    const { store } = await makeReadyStore();
    await render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MediHost />
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.queryByTestId('medi-input')).toBeNull();
    await act(async () => openMedi('button'));
    expect(screen.getByTestId('medi-input')).toBeTruthy();
    await act(async () => closeMedi());
    expect(screen.queryByTestId('medi-input')).toBeNull(); // Modal hidden; state kept in the mounted sheet
  });
});
