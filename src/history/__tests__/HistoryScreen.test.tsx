import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import HistoryTab from '../../../app/(app)/(tabs)/history';
import { track } from '@/analytics/track';
import { setIdTokenProvider } from '@/api/authToken';
import { i18n } from '@/i18n';
import { record } from '@/jobs/testFixtures';
import { jobUpserted } from '@/state/slices/jobs';
import { makeReadyStore } from '@/state/testing';
import { deleteResult } from '@/results/deleteJob';
import { clearEntryCache, recallEntry } from '../entryCache';

const mockPush = jest.fn();
let mockHours = 168;
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), navigate: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('@/api/hooks', () => ({
  useGetAccountMeQuery: () => ({ data: { limits: { resultRetentionHours: mockHours } } }),
}));
jest.mock('@/results/actionDeps', () => ({ realDeleteDeps: () => ({}) }));
jest.mock('@/results/deleteJob', () => ({ deleteResult: jest.fn() }));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children: unknown }) => <View>{children as never}</View>,
  };
});

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const row = (id: string, over: Record<string, unknown> = {}) => ({
  jobId: id,
  tool: 'convert',
  mediaKind: 'image',
  sourceFormat: 'jpg',
  targetFormat: 'png',
  status: 'completed',
  createdAt: iso(0),
  expired: false,
  deletesOn: iso(-5),
  downloadPath: `/download/${id}`,
  ...over,
});

let rows: ReturnType<typeof row>[] = [];
const realFetch = global.fetch;

function mockFetch() {
  global.fetch = jest.fn((url: string) => {
    void url;
    const body = { entries: rows, total: rows.length, limit: 50, offset: 0 };
    return Promise.resolve({
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }) as unknown as typeof fetch;
}

async function setup() {
  const { store } = await makeReadyStore();
  const utils = await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <HistoryTab />
      </I18nextProvider>
    </Provider>,
  );
  return { store, ...utils };
}

beforeEach(() => {
  setIdTokenProvider(() => Promise.resolve(null));
  (track as jest.Mock).mockClear();
  (deleteResult as jest.Mock).mockReset();
  mockPush.mockClear();
  clearEntryCache();
  mockHours = 168;
  mockFetch();
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('HistoryScreen', () => {
  it('shows the empty state naming the retention period', async () => {
    rows = [];
    await setup();
    expect(await screen.findByText('No results yet')).toBeTruthy();
    expect(await screen.findByText(/7 days/)).toBeTruthy();
  });

  it('renders rows under Today and an In progress section for a local job', async () => {
    rows = [row('a'), row('b', { createdAt: iso(1), status: 'failed' })];
    const { store } = await setup();
    await act(async () => {
      store.dispatch(
        jobUpserted(record({ localId: 'l1', state: 'uploading', uploadProgress: 0.4 })),
      );
    });
    expect(await screen.findByTestId('history-row-a')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByTestId('pending-row-l1')).toBeTruthy();
    expect(screen.getByTestId('history-status-b').props.children).toBe('Failed');
  });

  it('a pending record disappears once the server lists its jobId', async () => {
    rows = [row('srv-1')];
    const { store } = await setup();
    await act(async () => {
      store.dispatch(jobUpserted(record({ localId: 'l1', jobId: 'srv-1', state: 'processing' })));
    });
    await screen.findByTestId('history-row-srv-1');
    expect(screen.queryByTestId('pending-row-l1')).toBeNull();
  });

  it('reopen emits history_item_reopened with age_bucket and navigates with from=history', async () => {
    rows = [row('a', { createdAt: iso(3) })];
    await setup();
    fireEvent.press(await screen.findByTestId('history-row-a'));
    expect(track).toHaveBeenCalledWith('history_item_reopened', {
      kind: 'image',
      age_bucket: '1-7d',
      source: 'account',
    });
    expect(mockPush).toHaveBeenCalledWith('/(app)/job/a?from=history');
    expect(recallEntry('a')?.jobId).toBe('a');
  });

  it('an expired row is greyed with Expired and does not open', async () => {
    rows = [row('e', { expired: true, downloadPath: undefined })];
    await setup();
    fireEvent.press(await screen.findByTestId('history-row-e'));
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('delete is optimistic and the row comes back when the delete fails', async () => {
    rows = [row('a'), row('b')];
    let finish!: (v: unknown) => void;
    (deleteResult as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await setup();
    fireEvent(await screen.findByTestId('history-row-a'), 'longPress');
    fireEvent.press(await screen.findByTestId('menu-delete'));
    fireEvent.press(await screen.findByTestId('confirm-delete'));
    await waitFor(() => expect(screen.queryByTestId('history-row-a')).toBeNull());
    expect(screen.getByTestId('history-row-b')).toBeTruthy();
    await act(async () => finish({ status: 'failed' }));
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());
  });

  it('delete success keeps the row removed', async () => {
    rows = [row('a'), row('b')];
    (deleteResult as jest.Mock).mockResolvedValue({ status: 'deleted', pending: false });
    await setup();
    fireEvent(await screen.findByTestId('history-row-a'), 'longPress');
    fireEvent.press(await screen.findByTestId('menu-delete'));
    fireEvent.press(await screen.findByTestId('confirm-delete'));
    await waitFor(() => expect(screen.queryByTestId('history-row-a')).toBeNull());
    expect(deleteResult).toHaveBeenCalledWith('a', expect.anything(), expect.anything());
  });

  it('shows a Try again row when the first page fails', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status: 503,
        headers: new Headers(),
        text: () => Promise.resolve('{"error":"x"}'),
      }),
    ) as unknown as typeof fetch;
    await setup();
    expect(await screen.findByText("Couldn't load your history.")).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
