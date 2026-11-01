import { Pressable, View } from 'react-native';
import { dismissNotice, useNotice } from '../notice';
import { Text } from './Text';

/** Renders the current `showNotice` message above the screen; mounted once in the signed-in layout. */
export function NoticeHost() {
  const notice = useNotice();
  if (!notice) return null;
  return (
    <View pointerEvents="box-none" className="absolute inset-x-4 bottom-6">
      <Pressable
        onPress={dismissNotice}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="notice"
        className={`rounded-lg border bg-surface-3 px-4 py-3 ${notice.tone === 'error' ? 'border-danger' : 'border-edge-strong'}`}
      >
        <Text className={notice.tone === 'error' ? 'text-danger' : ''}>{notice.text}</Text>
      </Pressable>
    </View>
  );
}
