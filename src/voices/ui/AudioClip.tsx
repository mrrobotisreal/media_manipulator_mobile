import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatDuration } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { Num } from '@/ui/components/Text';

/**
 * A play / pause row for a short clip (a take, a design preview, a saved voice's preview). `label` names it
 * for TalkBack; the elapsed / total clock is mono numerals.
 */
export function AudioClip({ uri, label, testID }: { uri: string; label: string; testID?: string }) {
  const { t } = useTranslation();
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const duration = status.duration > 0 ? status.duration : 0;
  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // A finished clip restarts.
    if (duration > 0 && status.currentTime >= duration - 0.05) void player.seekTo(0);
    player.play();
  };
  return (
    <View className="flex-row items-center gap-3" testID={testID}>
      <Button
        variant="secondary"
        label={
          status.playing
            ? t('interface:resultPanel.compareModes.pause')
            : t('interface:resultPanel.compareModes.play')
        }
        accessibilityLabel={label}
        onPress={toggle}
      />
      <Num className="text-sm text-muted-fg">
        {formatDuration(status.currentTime)} / {formatDuration(duration)}
      </Num>
    </View>
  );
}
