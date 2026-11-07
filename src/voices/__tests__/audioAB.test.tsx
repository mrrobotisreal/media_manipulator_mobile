import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { AudioViewer } from '@/results/viewers/AudioViewer';
import type { ResultDescriptor } from '@/results/describe';
import { i18n } from '@/i18n';
import { track } from '@/analytics/track';

type Player = { play: jest.Mock; pause: jest.Mock; seekTo: jest.Mock; id: string };
const mockPlayers: Player[] = [];
let mockStatus: Record<string, { playing: boolean; currentTime: number; duration: number }> = {};
jest.mock('expo-audio', () => ({
  useAudioPlayer: (src: { uri: string } | null) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useState } = require('react');
    const [p] = useState(() => {
      const made = {
        id: src?.uri ?? 'none',
        play: jest.fn(),
        pause: jest.fn(),
        seekTo: jest.fn(() => Promise.resolve()),
      };
      mockPlayers.push(made);
      return made;
    });
    return p;
  },
  useAudioPlayerStatus: (p: Player) => ({
    isLoaded: true,
    playbackState: 'ok',
    ...(mockStatus[p.id] ?? { playing: false, currentTime: 0, duration: 10 }),
  }),
}));
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('@/results/useResultFile', () => ({
  useResultFile: () => ({
    state: { status: 'ready', file: { uri: 'file:///results/out.mp3' } },
    reload: jest.fn(),
  }),
}));
jest.mock('@/results/viewers/streamSource', () => ({ useStreamSource: () => null }));
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => ({
      minDistance: () => ({ onBegin: () => ({ onUpdate: () => ({ runOnJS: () => ({}) }) }) }),
    }),
  },
  GestureDetector: ({ children }: { children: unknown }) => children,
}));

const descriptor = (original?: ResultDescriptor['original']): ResultDescriptor => ({
  kind: 'audio',
  mime: 'audio/mpeg',
  fileName: 'speech.mp3',
  jobId: 'job-1',
  downloadUrl: 'x',
  mimeFromServer: false,
  original,
});
const view = (d: ResultDescriptor) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AudioViewer descriptor={d} context={{ jobId: 'job-1' }} />
    </I18nextProvider>,
  );

beforeEach(() => {
  mockPlayers.length = 0;
  mockStatus = {};
  (track as jest.Mock).mockClear();
});

describe('A/B toggle on a voice result (MA34 decision 8)', () => {
  it('shows no toggle when there is no original (a speak result)', async () => {
    await view(descriptor());
    expect(screen.queryByTestId('audio-ab')).toBeNull();
  });

  it('shows Original / Result when the recording was kept, Result first', async () => {
    await view(
      descriptor({
        uri: 'file:///originals/job-1/in.m4a',
        name: 'in.m4a',
        mime: 'audio/mp4',
        kind: 'audio',
      }),
    );
    expect(screen.getByTestId('audio-ab')).toBeTruthy();
    expect(screen.getByTestId('audio-ab-result').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('audio-ab-original').props.accessibilityState.selected).toBe(false);
  });

  it('switching keeps the playback position and keeps playing, and counts one compare', async () => {
    // The result side is playing at 3.5 s when the user flips to the original.
    mockStatus['file:///results/out.mp3'] = { playing: true, currentTime: 3.5, duration: 10 };
    await view(
      descriptor({
        uri: 'file:///originals/job-1/in.m4a',
        name: 'in.m4a',
        mime: 'audio/mp4',
        kind: 'audio',
      }),
    );
    const result = mockPlayers.find((p) => p.id === 'file:///results/out.mp3')!;
    const original = mockPlayers.find((p) => p.id === 'file:///originals/job-1/in.m4a')!;
    await act(async () => {
      fireEvent.press(screen.getByTestId('audio-ab-original'));
    });
    expect(result.pause).toHaveBeenCalled();
    expect(original.seekTo).toHaveBeenCalledWith(3.5);
    expect(original.play).toHaveBeenCalled();
    expect(screen.getByTestId('audio-ab-original').props.accessibilityState.selected).toBe(true);
    expect((track as jest.Mock).mock.calls.filter((c) => c[0] === 'result_compare_used')).toEqual([
      [
        'result_compare_used',
        { job_id: 'job-1', kind: 'audio', mode: 'toggle' },
        expect.anything(),
      ],
    ]);
  });

  it('switching while paused seeks but does not start playback', async () => {
    await view(
      descriptor({
        uri: 'file:///originals/job-1/in.m4a',
        name: 'in.m4a',
        mime: 'audio/mp4',
        kind: 'audio',
      }),
    );
    const original = mockPlayers.find((p) => p.id === 'file:///originals/job-1/in.m4a')!;
    await act(async () => {
      fireEvent.press(screen.getByTestId('audio-ab-original'));
    });
    expect(original.seekTo).toHaveBeenCalled();
    expect(original.play).not.toHaveBeenCalled();
  });
});
