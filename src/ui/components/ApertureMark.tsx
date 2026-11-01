import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../tokens';

/**
 * Ported from media-manipulator-ui/components/darkroom/aperture-paths.ts and wordmark.tsx
 * (24x24 viewBox, six-blade iris). Geometry is copied verbatim; see the web file for the
 * derivation of each number.
 */
export const OPENING_BLADES =
  'M15.9 12 L13.95 15.38 L10.05 15.38 L8.1 12 L10.05 8.62 L13.95 8.62 Z';
export const BLADE_SEAMS = [
  'M14.37 7.86 L19.91 17.44',
  'M16.77 11.99 L11.24 21.57',
  'M14.4 16.13 L3.33 16.13',
  'M9.63 16.14 L4.09 6.56',
  'M7.23 12.01 L12.76 2.43',
  'M9.6 7.87 L20.67 7.87',
].join(' ');

export function ApertureMark({
  size = 36,
  color = colors.primary,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={1.5} />
      <Path d={OPENING_BLADES} fill={color} />
      <Path d={BLADE_SEAMS} fill="none" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}
