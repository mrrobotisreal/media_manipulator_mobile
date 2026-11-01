import { VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { track } from '@/analytics/track';
import { Button } from '@/ui/components/Button';
import { PointTrack, RangeTrack } from './RangeTrack';
import { ThumbStrip } from './ThumbStrip';
import { useScrubPlayer } from './useScrubPlayer';
import { thumbCount, useVideoThumbnails } from './useVideoThumbnails';

export interface TrimRangeScrubberProps {
  uri: string;
  /** Duration from intake; the player value replaces it once ready. */
  durationSec?: number;
  start: number;
  end: number;
  minGap?: number;
  onChange: (start: number, end: number, duration: number) => void;
  /** Called once the real duration is known (forms seed a default range from it). */
  onDuration?: (duration: number) => void;
}

/**
 * Preview + thumbnail strip + two handles. The preview seeks to the handle being dragged; "Play
 * selection" plays start..end and stops at the end. Emits `options_changed {option:'trim'}` once per
 * gesture end.
 */
export function TrimRangeScrubber(props: TrimRangeScrubberProps) {
  const { uri, durationSec, start, end, minGap, onChange, onDuration } = props;
  const { t } = useTranslation();
  const { player, duration } = useScrubPlayer(uri, durationSec);
  const [trackW, setTrackW] = useState(0);
  const thumbs = useVideoThumbnails(player, duration, thumbCount(trackW));
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    if (duration) onDuration?.(duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  useEffect(() => {
    const sub = player.addListener('timeUpdate', (e) => {
      if (!player.playing) return;
      setPlayhead(e.currentTime);
      if (e.currentTime >= endRef.current) {
        player.pause();
        setPlaying(false);
      }
    });
    return () => sub.remove();
  }, [player]);

  if (!duration) return <View testID="trim-scrubber-loading" />;

  const stop = () => {
    player.pause();
    setPlaying(false);
  };
  const toggle = () => {
    if (playing) return stop();
    player.currentTime = start;
    setPlayhead(start);
    player.play();
    setPlaying(true);
  };

  return (
    <View className="gap-3" testID="trim-scrubber">
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }}
      />
      <RangeTrack
        duration={duration}
        start={start}
        end={end}
        minGap={minGap}
        playhead={playing ? playhead : undefined}
        onTrackWidth={setTrackW}
        onScrubStart={stop}
        onScrub={(time) => {
          player.currentTime = time;
        }}
        onScrubEnd={() => track('options_changed', { option: 'trim' })}
        onChange={(s, e) => onChange(s, e, duration)}
        background={<ThumbStrip state={thumbs} />}
      />
      <Button
        variant="secondary"
        label={playing ? t('toolUi.range.pause') : t('toolUi.range.play')}
        onPress={toggle}
      />
    </View>
  );
}

export interface FramePickerProps {
  uri: string;
  durationSec?: number;
  onAdd: (time: number) => void;
  addLabel: string;
  onDuration?: (duration: number) => void;
}

/** Single-playhead variant for "Add this moment" (Extract frames). */
export function FramePicker({ uri, durationSec, onAdd, addLabel, onDuration }: FramePickerProps) {
  const { player, duration } = useScrubPlayer(uri, durationSec);
  const [trackW, setTrackW] = useState(0);
  const thumbs = useVideoThumbnails(player, duration, thumbCount(trackW));
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (duration) onDuration?.(duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);
  if (!duration) return <View testID="frame-picker-loading" />;
  return (
    <View className="gap-3" testID="frame-picker">
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }}
      />
      <PointTrack
        duration={duration}
        value={at}
        onTrackWidth={setTrackW}
        onChange={(time) => {
          setAt(time);
          player.currentTime = time;
        }}
        background={<ThumbStrip state={thumbs} />}
      />
      <Button variant="secondary" label={addLabel} onPress={() => onAdd(at)} />
    </View>
  );
}
