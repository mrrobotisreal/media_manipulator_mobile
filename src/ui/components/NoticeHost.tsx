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
        <View className="flex-row items-center gap-3">
          <Text className={`flex-1 ${notice.tone === 'error' ? 'text-danger' : ''}`}>
            {notice.text}
          </Text>
          {notice.action ? (
            <Pressable
              accessibilityRole="button"
              testID="notice-action"
              hitSlop={8}
              onPress={() => {
                const { onPress } = notice.action!;
                dismissNotice();
                onPress();
              }}
              className="min-h-11 justify-center px-2"
            >
              <Text className="font-semibold text-data">{notice.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}
