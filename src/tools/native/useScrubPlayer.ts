import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';

export interface ScrubPlayer {
  player: VideoPlayer;
  /** Seconds once the player is ready, else the intake probe value, else undefined. */
  duration: number | undefined;
  /** Display size from the platform video track, once known. */
  size: { width: number; height: number } | null;
  ready: boolean;
}

/** One paused, muted expo-video player per file for the scrubber preview and the thumbnails. */
export function useScrubPlayer(uri: string, probedDuration?: number): ScrubPlayer {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = 0.1;
  });
  const [duration, setDuration] = useState<number | undefined>(probedDuration);
  const [size, setSize] = useState<ScrubPlayer['size']>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onReady = () => {
      setReady(true);
      if (Number.isFinite(player.duration) && player.duration > 0) setDuration(player.duration);
      const s = player.videoTrack?.size;
      if (s && s.width > 0 && s.height > 0) setSize({ width: s.width, height: s.height });
    };
    if (player.status === 'readyToPlay') onReady();
    const sub = player.addListener('statusChange', (e) => {
      if (e.status === 'readyToPlay') onReady();
    });
    return () => sub.remove();
  }, [player]);
  return { player, duration, size, ready };
}
