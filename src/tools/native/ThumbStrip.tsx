import { Image } from 'expo-image';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/ui/components/Text';
import type { ThumbState } from './useVideoThumbnails';

/** The thumbnail row behind a range or point track. */
export function ThumbStrip({ state }: { state: ThumbState }) {
  const { t } = useTranslation();
  if (state.status === 'ready') {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }} testID="thumb-strip">
        {state.thumbs.map((th, i) => (
          <Image key={i} source={th} style={{ flex: 1 }} contentFit="cover" />
        ))}
      </View>
    );
  }
  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text className="text-xs text-subtle">{t('toolUi.range.loadingThumbs')}</Text>
      </View>
    );
  }
  return null;
}
