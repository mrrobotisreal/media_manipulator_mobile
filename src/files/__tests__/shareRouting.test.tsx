import { render, waitFor } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { makeReadyStore } from '@/state/testing';
import { useShareIntentRouting } from '../share-intent';

const mockPush = jest.fn();
const mockReset = jest.fn();
let mockCtx: {
  hasShareIntent: boolean;
  shareIntent: { files: unknown[] | null };
  resetShareIntent: jest.Mock;
};
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-share-intent', () => ({ useShareIntentContext: () => mockCtx }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const mockPrepare = jest.fn(async () => ({ accepted: [], rejected: [] }));
jest.mock('../intake', () => ({ prepareIntake: () => mockPrepare() }));

function Probe() {
  useShareIntentRouting();
  return null;
}

const share = { path: 'content://x', mimeType: 'image/png', fileName: 'a.png', size: 5 };

async function mount(status: string) {
  const { store } = await makeReadyStore();
  store.dispatch({ type: 'auth/statusChanged', payload: status });
  const utils = await render(
    <Provider store={store}>
      <Probe />
    </Provider>,
  );
  return { store, ...utils };
}

beforeEach(() => {
  mockPush.mockClear();
  mockReset.mockClear();
  mockPrepare.mockClear();
});

describe('useShareIntentRouting', () => {
  it('holds the share until auth is ready, then routes to intake and resets', async () => {
    mockCtx = {
      hasShareIntent: true,
      shareIntent: { files: [share] },
      resetShareIntent: mockReset,
    };
    const { store } = await mount('signedOut');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
    store.dispatch({ type: 'auth/statusChanged', payload: 'ready' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(app)/intake'));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('routes immediately when already signed in', async () => {
    mockCtx = {
      hasShareIntent: true,
      shareIntent: { files: [share] },
      resetShareIntent: mockReset,
    };
    await mount('ready');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(app)/intake'));
  });

  it('ignores a text-only share and resets it without navigating', async () => {
    mockCtx = { hasShareIntent: true, shareIntent: { files: null }, resetShareIntent: mockReset };
    await mount('ready');
    expect(mockReset).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('does nothing without a share', async () => {
    mockCtx = { hasShareIntent: false, shareIntent: { files: null }, resetShareIntent: mockReset };
    await mount('ready');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
