import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { RangeTrack } from './RangeTrack';

const BARS = 48;

/** Placeholder strip (real peaks are out of scope: expo-audio exposes no decode ahead of playback). */
function PlaceholderStrip() {
  return (
    <View
      testID="range-placeholder"
      className="flex-1 flex-row items-center justify-between px-1"
      pointerEvents="none"
    >
      {Array.from({ length: BARS }, (_, i) => (
        <View key={i} className="h-5 w-0.5 rounded-full bg-edge-strong" />
      ))}
    </View>
  );
}

export interface AudioRangeEditorProps {
  uri: string;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** Duration known from intake; used until the player reports its own. */
  fallbackDuration?: number;
  /** Fires once with the player's duration. */
  onDuration?: (seconds: number) => void;
}

/**
 * Audio trim editor: `RangeTrack` over a placeholder strip, plus "Play selection", which plays from
 * `start` and pauses at `end` (playhead updates every 100 ms).
 */
export function AudioRangeEditor({
  uri,
  start,
  end,
  onChange,
  fallbackDuration,
  onDuration,
}: AudioRangeEditorProps) {
  const { t } = useTranslation();
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [armed, setArmed] = useState(false);
  const reported = useRef(false);

  const duration =
    status.isLoaded && status.duration > 0 ? status.duration : (fallbackDuration ?? 0);
  useEffect(() => {
    if (status.isLoaded && status.duration > 0 && !reported.current) {
      reported.current = true;
      onDuration?.(status.duration);
    }
  }, [status.isLoaded, status.duration, onDuration]);

  // Playing = armed by "Play selection" and still before the end handle; crossing it pauses.
  const playing = armed && status.currentTime < end;
  const crossed = armed && status.currentTime >= end;
  useEffect(() => {
    if (crossed) player.pause();
  }, [crossed, player]);

  const toggle = useCallback(async () => {
    if (playing) {
      player.pause();
      setArmed(false);
      return;
    }
    await player.seekTo(start);
    setArmed(true);
    player.play();
  }, [playing, player, start]);

  const onScrubStart = useCallback(() => {
    if (armed) {
      player.pause();
      setArmed(false);
    }
  }, [armed, player]);

  if (!(duration > 0)) {
    return (
      <Text className="text-sm text-muted-fg" testID="range-loading">
        {t('toolUi.range.loading')}
      </Text>
    );
  }

  return (
    <View className="gap-3" testID="audio-range-editor">
      <RangeTrack
        duration={duration}
        start={start}
        end={end}
        playhead={playing ? status.currentTime : undefined}
        onChange={onChange}
        onScrubStart={onScrubStart}
        background={<PlaceholderStrip />}
      />
      <Button
        variant="secondary"
        label={playing ? t('toolUi.range.pause') : t('toolUi.range.play')}
        onPress={() => void toggle()}
        disabled={!status.isLoaded}
      />
    </View>
  );
}
