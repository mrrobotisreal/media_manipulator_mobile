import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { AudioRangeEditor } from '../AudioRangeEditor';

const mockPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(async () => undefined),
};
let mockStatus = { isLoaded: false, duration: 0, currentTime: 0 };
const mockUse = jest.fn((..._a: unknown[]) => mockPlayer);
jest.mock('expo-audio', () => ({
  useAudioPlayer: (...a: unknown[]) => mockUse(...a),
  useAudioPlayerStatus: () => mockStatus,
}));

const ui = (props: Partial<React.ComponentProps<typeof AudioRangeEditor>> = {}) => (
  <I18nextProvider i18n={i18n}>
    <AudioRangeEditor uri="file:///a.mp3" start={10} end={20} onChange={jest.fn()} {...props} />
  </I18nextProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = { isLoaded: false, duration: 0, currentTime: 0 };
});

describe('AudioRangeEditor', () => {
  it('shows the loading state until the player reports a duration', async () => {
    await render(ui());
    expect(screen.getByTestId('range-loading')).toBeTruthy();
  });

  it('reads the duration from the player once loaded and polls every 100 ms', async () => {
    mockStatus = { isLoaded: true, duration: 60, currentTime: 0 };
    const onDuration = jest.fn();
    await render(ui({ onDuration }));
    expect(onDuration).toHaveBeenCalledWith(60);
    expect(mockUse).toHaveBeenCalledWith('file:///a.mp3', { updateInterval: 100 });
    expect(screen.getByTestId('audio-range-editor')).toBeTruthy();
    expect(screen.getByTestId('range-placeholder')).toBeTruthy();
  });

  it('selection play starts at the start handle and pauses at the end handle', async () => {
    mockStatus = { isLoaded: true, duration: 60, currentTime: 0 };
    const view = await render(ui());
    await fireEvent.press(screen.getByText('Play selection'));
    await act(async () => undefined);
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(10);
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(mockPlayer.pause).not.toHaveBeenCalled();
    mockStatus = { isLoaded: true, duration: 60, currentTime: 20.1 };
    await view.rerender(ui());
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Play selection')).toBeTruthy();
  });

  it('uses the intake duration while the player is not loaded', async () => {
    await render(ui({ fallbackDuration: 90 }));
    expect(screen.getByTestId('audio-range-editor')).toBeTruthy();
  });
});
