import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { ApertureMark } from './ApertureMark';

/** Rotating aperture; static when the OS asks for reduced motion. */
export function ProcessingIndicator({
  size = 32,
  label = 'Processing',
}: {
  size?: number;
  label?: string;
}) {
  // i18n: MA05
  const [reduced, setReduced] = useState(false);
  const r = useSharedValue(0);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (reduced) {
      cancelAnimation(r);
      r.value = 0;
    } else {
      r.value = withRepeat(withTiming(360, { duration: 2400, easing: Easing.linear }), -1, false);
    }
    return () => cancelAnimation(r);
  }, [reduced, r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Animated.View accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
      <ApertureMark size={size} />
    </Animated.View>
  );
}
