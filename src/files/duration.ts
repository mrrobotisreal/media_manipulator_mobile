import { createAudioPlayer } from 'expo-audio';
import { createVideoPlayer } from 'expo-video';

export const PROBE_TIMEOUT_MS = 5000;

/**
 * Duration in seconds via a throwaway player, or undefined on timeout/failure. A failed probe never
 * blocks a file (the server stays the authority and MA16 renders its 413).
 */
export async function probeDuration(
  uri: string,
  kind: 'video' | 'audio',
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    let done = false;
    let release: () => void = () => undefined;
    const finish = (value: number | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        release();
      } catch {
        // already released
      }
      resolve(value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    try {
      if (kind === 'video') {
        const player = createVideoPlayer({ uri });
        release = () => player.release();
        player.addListener('sourceLoad', (e) => finish(e.duration));
        player.addListener('statusChange', (e) => {
          if (e.status === 'error') finish(undefined);
        });
      } else {
        const player = createAudioPlayer({ uri });
        release = () => player.remove();
        player.addListener('playbackStatusUpdate', (s) => {
          if (s.isLoaded && s.duration > 0) finish(s.duration);
        });
      }
    } catch {
      finish(undefined);
    }
  });
}
