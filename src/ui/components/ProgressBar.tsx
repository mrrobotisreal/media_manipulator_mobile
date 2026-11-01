import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, motion } from '../tokens';

/** value 0..1 = determinate; omit for indeterminate. Animates transform only. */
export function ProgressBar({
  value,
  accent = 'primary',
}: {
  value?: number;
  accent?: 'primary' | 'data';
}) {
  const p = useSharedValue(0);
  const determinate = value !== undefined;
  useEffect(() => {
    if (determinate) {
      cancelAnimation(p);
      p.value = withTiming(Math.min(1, Math.max(0, value)), { duration: motion.base });
    } else {
      p.value = 0;
      p.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false);
    }
    return () => cancelAnimation(p);
  }, [determinate, value, p]);
  const style = useAnimatedStyle(() =>
    determinate
      ? { transform: [{ scaleX: p.value }] }
      : { transform: [{ translateX: (p.value - 0.5) * 300 }, { scaleX: 0.3 }] },
  );
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={
        determinate ? { min: 0, max: 100, now: Math.round(value * 100) } : undefined
      }
      className="h-0.5 overflow-hidden rounded-xs bg-edge"
    >
      <Animated.View
        style={[
          {
            height: 2,
            width: '100%',
            backgroundColor: accent === 'data' ? colors.data : colors.primary,
          },
          determinate ? { transformOrigin: 'left' } : null,
          style,
        ]}
      />
    </View>
  );
}
