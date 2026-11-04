import { View } from 'react-native';
import { ApertureMark } from './ApertureMark';
import { Text } from './Text';

const MARK = { xs: 24, sm: 36, lg: 44 } as const;
const TYPE = { xs: 'text-base', sm: 'text-lg', lg: 'text-2xl' } as const;

/** Aperture + two-tone type lockup (web: components/darkroom/wordmark.tsx). */
export function Wordmark({
  text = 'Media Manipulator',
  size = 'lg',
}: {
  text?: string;
  size?: 'xs' | 'sm' | 'lg';
}) {
  const idx = text.lastIndexOf(' ');
  const first = idx > 0 ? text.slice(0, idx) : text;
  const last = idx > 0 ? text.slice(idx + 1) : '';
  return (
    <View
      accessible
      accessibilityLabel={text}
      className={`flex-row items-center ${size === 'xs' ? 'gap-2' : 'gap-3'}`}
    >
      <ApertureMark size={MARK[size]} />
      <Text className={`font-semibold ${TYPE[size]}`}>
        {first}
        {last ? <Text className="text-primary"> {last}</Text> : null}
      </Text>
    </View>
  );
}
