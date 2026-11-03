import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useResultFile } from '../useResultFile';

const mockFetch = jest.fn();
jest.mock('../fetchResult', () => {
  const actual = jest.requireActual('../fetchResult');
  return {
    ...actual,
    fetchResultFile: (...a: unknown[]) => mockFetch(...a),
    realFetchDeps: () => ({}),
  };
});

let listener: ((s: AppStateStatus) => void) | null = null;
beforeEach(() => {
  mockFetch.mockReset();
  listener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    listener = cb as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});
afterEach(() => jest.restoreAllMocks());

describe('useResultFile: a download aborted in the background', () => {
  it('retries when the app is active again instead of showing an error', async () => {
    let fail: (e: Error) => void = () => undefined;
    mockFetch
      .mockImplementationOnce(() => new Promise((_r, rej) => (fail = rej)))
      .mockImplementationOnce(() => Promise.resolve({ uri: 'file:///r.png' }));
    const { result } = await renderHook(() => useResultFile('job-1', 'r.png', 10));
    await act(async () => {
      listener?.('background');
      fail(new Error('Software caused connection abort'));
    });
    expect(result.current.state.status).toBe('loading');
    await act(async () => listener?.('active'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a failure while in the foreground still shows the error', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network')));
    const { result } = await renderHook(() => useResultFile('job-2', 'r.png', 10));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
