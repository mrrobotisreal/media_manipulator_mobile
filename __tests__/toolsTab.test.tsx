import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import ToolsTab from '../app/(app)/(tabs)/index';
import { i18n } from '@/i18n';
import { toolOpened } from '@/state/slices/settings';
import { makeReadyStore } from '@/state/testing';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));
jest.mock('@/auth/ui/AuthBanners', () => ({ AuthBanners: () => null }));

async function renderTab(recents: string[] = []) {
  const { store } = await makeReadyStore();
  for (const id of [...recents].reverse()) store.dispatch(toolOpened(id));
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ToolsTab />
      </I18nextProvider>
    </Provider>,
  );
  return store;
}

describe('Tools tab', () => {
  beforeEach(() => {
    mockPush.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('renders the family sections and the quota slot', async () => {
    await renderTab();
    expect(screen.getByTestId('quota-header-slot')).toBeTruthy();
    // SectionList virtualizes: only the first window renders.
    expect(screen.getAllByText('Image').length).toBeGreaterThan(0);
    expect(screen.getByText('Convert image')).toBeTruthy();
    expect(screen.getByLabelText('Search tools')).toBeTruthy();
  });

  it('filters by search and shows the empty state', async () => {
    await renderTab();
    const input = screen.getByLabelText('Search tools');
    await fireEvent.changeText(input, 'gif');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByText('Video to GIF')).toBeTruthy();
    expect(screen.queryByText('Resize image')).toBeNull();

    await fireEvent.changeText(input, 'zzzqqq');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByText('No tools match “zzzqqq”.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Clear search'));
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByText('Resize image')).toBeTruthy();
  });

  it('shows Recent chips newest first and hides them while searching', async () => {
    await renderTab(['image-resize', 'transcribe']);
    expect(screen.getByText('Recent')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search tools'), 'gif');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('opens a tool with the entry point', async () => {
    await renderTab();
    // Persisted recents from other tests can add a chip; the list row is the last match.
    await fireEvent.press(screen.getAllByText('Resize image').at(-1)!);
    expect(mockPush).toHaveBeenCalledWith('/(app)/tool/image/image-resize?from=tools_tab');
  });
});
