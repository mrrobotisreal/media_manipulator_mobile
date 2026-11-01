import { act, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import JobRoute from '../../../app/(app)/job/[jobId]';
import { track } from '@/analytics/track';
import { i18n } from '@/i18n';
import { record, snapshot } from '@/jobs/testFixtures';
import { resetResultAnalyticsForTests } from '@/analytics/resultEvents';
import { jobUpserted } from '@/state/slices/jobs';
import { makeReadyStore } from '@/state/testing';

let mockParams: Record<string, string> = {};
let mockRemote: { data?: unknown; error?: unknown } = {};
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: { replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn() },
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('@/jobs/runtime', () => ({
  getJobEngine: () => ({
    watch: jest.fn(),
    unwatch: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
    stopWatching: jest.fn(),
  }),
}));
jest.mock('@/api/endpoints/jobs', () => ({ useGetJobQuery: () => mockRemote }));
jest.mock('@/results/cache', () => ({
  findOriginal: () => undefined,
  sweepResultCache: jest.fn(),
}));
jest.mock('@/results/viewers', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    viewerFor: (kind: string) => () => <Text>{`viewer:${kind}`}</Text>,
  };
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({
  ProcessingIndicator: () => null,
}));
jest.mock('@/ui/components/ProgressBar', () => ({ ProgressBar: () => null }));

async function setup(params: Record<string, string>, seed?: ReturnType<typeof record>) {
  mockParams = params;
  const { store } = await makeReadyStore();
  if (seed) store.dispatch(jobUpserted(seed));
  const utils = await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <JobRoute />
      </I18nextProvider>
    </Provider>,
  );
  return { store, ...utils };
}

const completed = (over = {}) =>
  record({
    localId: 'local_1',
    jobId: 'srv-1',
    state: 'completed',
    job: snapshot({
      id: 'srv-1',
      status: 'completed',
      resultFileName: 'photo.png',
      resultSizeBytes: 2048,
      expiresAt: '2026-11-02T00:00:00Z',
    }),
    ...over,
  });

beforeEach(() => {
  (track as jest.Mock).mockClear();
  resetResultAnalyticsForTests();
  mockRemote = {};
  mockReplace.mockClear();
});

describe('result screen', () => {
  it('moves from progress to the result when the slice updates, and fires result_viewed once', async () => {
    const processing = record({
      localId: 'local_1',
      jobId: 'srv-1',
      state: 'processing',
      progress: 40,
    });
    const { store } = await setup({ jobId: 'local_1' }, processing);
    expect(screen.getByText('Processing… 40%')).toBeTruthy();
    expect(screen.queryByText('viewer:image')).toBeNull();

    await act(async () => {
      store.dispatch(jobUpserted(completed()));
    });
    expect(screen.getByText('viewer:image')).toBeTruthy();
    expect(screen.getByText('Image')).toBeTruthy();
    const viewed = (track as jest.Mock).mock.calls.filter(([n]) => n === 'result_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0][1]).toEqual({
      job_id: 'srv-1',
      kind: 'image',
      surface: 'tool_page',
      has_original: false,
    });
    expect(viewed[0][2]).toMatchObject({ job_id: 'srv-1', tool_slug: 'image-converter' });

    // A rerender (another slice update) never re-fires.
    await act(async () => {
      store.dispatch(jobUpserted(completed({ watch: true })));
    });
    expect((track as jest.Mock).mock.calls.filter(([n]) => n === 'result_viewed')).toHaveLength(1);
  });

  it('uses surface history when opened from History', async () => {
    await setup({ jobId: 'srv-1', from: 'history' }, completed());
    expect((track as jest.Mock).mock.calls.find(([n]) => n === 'result_viewed')?.[1]).toMatchObject(
      { surface: 'history' },
    );
  });

  it.each([
    ['failed', 'The server could not finish this job. Try again, or try different settings.'],
    ['lost', 'The server restarted and lost this job. Run it again.'],
    ['cancelled', 'This upload was cancelled.'],
  ] as const)('shows %s copy from the failure map', async (state, copy) => {
    await setup({ jobId: 'local_1' }, record({ localId: 'local_1', state }));
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByText('Back to tool')).toBeTruthy();
  });

  it('upload_failed offers Try again and maps the interrupted code', async () => {
    await setup(
      { jobId: 'local_1' },
      record({
        localId: 'local_1',
        state: 'upload_failed',
        error: { status: 'FETCH_ERROR', code: 'interrupted', details: {} },
      }),
    );
    expect(screen.getByText('The upload was interrupted.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('rejected shows the mapped summary and a Details button', async () => {
    await setup(
      { jobId: 'local_1' },
      record({
        localId: 'local_1',
        state: 'rejected',
        error: { status: 413, code: 'payload_too_large', details: {} },
      }),
    );
    expect(screen.getByText('This file is larger than your plan allows.')).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('deep link by a server id with no local record fetches the job once and shows the result', async () => {
    mockRemote = { data: snapshot({ id: 'srv-9', status: 'completed', resultFileName: 'a.mp3' }) };
    await setup({ jobId: 'srv-9' });
    expect(screen.getByText('viewer:audio')).toBeTruthy();
    expect((track as jest.Mock).mock.calls.filter(([n]) => n === 'result_viewed')).toHaveLength(1);
  });

  it('a 404 for an unknown server id shows "no longer on the server" with a History link', async () => {
    mockRemote = { error: { status: 404 } };
    await setup({ jobId: 'srv-gone' });
    expect(screen.getByText('This result is no longer on the server.')).toBeTruthy();
    expect(screen.getByText('Open History')).toBeTruthy();
  });
});
