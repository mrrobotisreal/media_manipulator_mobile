import { View } from 'react-native';
import { ApertureMark } from './ApertureMark';
import { Text } from './Text';

/** Aperture + two-tone type lockup (web: components/darkroom/wordmark.tsx). */
export function Wordmark({
  text = 'Media Manipulator',
  size = 'lg',
}: {
  text?: string;
  size?: 'sm' | 'lg';
}) {
  const idx = text.lastIndexOf(' ');
  const first = idx > 0 ? text.slice(0, idx) : text;
  const last = idx > 0 ? text.slice(idx + 1) : '';
  return (
    <View accessible accessibilityLabel={text} className="flex-row items-center gap-3">
      <ApertureMark size={size === 'lg' ? 44 : 36} />
      <Text className={`font-semibold ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}>
        {first}
        {last ? <Text className="text-primary"> {last}</Text> : null}
      </Text>
    </View>
  );
}
