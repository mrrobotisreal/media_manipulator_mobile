import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { track } from '@/analytics/track';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { TrimRangeScrubber } from '../TrimRangeScrubber';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const mockGenerate = jest.fn((times: number[]) =>
  Promise.resolve(times.map((t) => ({ requestedTime: t }))),
);
const mockPlayer = {
  status: 'readyToPlay',
  duration: 60,
  currentTime: 0,
  playing: false,
  videoTrack: { size: { width: 1080, height: 1920 } },
  generateThumbnailsAsync: mockGenerate,
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  play: jest.fn(),
  pause: jest.fn(),
};
jest.mock('expo-video', () => ({
  useVideoPlayer: () => mockPlayer,
  VideoView: () => null,
  createVideoPlayer: jest.fn(),
}));

async function setup(onChange = jest.fn()) {
  const { store } = await makeReadyStore();
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <TrimRangeScrubber uri="file:///a.mp4" start={10} end={20} onChange={onChange} />
      </I18nextProvider>
    </Provider>,
  );
  return onChange;
}

beforeEach(() => {
  mockGenerate.mockClear();
  (track as jest.Mock).mockClear();
  mockPlayer.currentTime = 0;
});

describe('TrimRangeScrubber', () => {
  it('requests the thumbnails once, with maxWidth 160, and shows the readouts', async () => {
    await setup();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const [times, opts] = mockGenerate.mock.calls[0] as unknown as [number[], { maxWidth: number }];
    expect(times).toHaveLength(6);
    expect(opts).toEqual({ maxWidth: 160 });
    expect(screen.getByTestId('range-readout-start')).toHaveTextContent(/0:10\.0/);
    expect(screen.getByTestId('range-readout-end')).toHaveTextContent(/0:20\.0/);
  });

  it('handles report start/end through accessibility actions and seek the preview', async () => {
    const onChange = await setup();
    fireEvent(screen.getByTestId('range-handle-start'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onChange).toHaveBeenLastCalledWith(11, 20, 60);
    expect(mockPlayer.currentTime).toBe(11);
    fireEvent(screen.getByTestId('range-handle-end'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(onChange).toHaveBeenLastCalledWith(10, 19, 60);
    expect(track).toHaveBeenCalledWith('options_changed', { option: 'trim' });
  });
});
