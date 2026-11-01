import { StyleSheet } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

/** Transparency grid behind PNG/WebP/AVIF results. */
export function Checkerboard({ cell = 12 }: { cell?: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <Pattern id="chk" width={cell * 2} height={cell * 2} patternUnits="userSpaceOnUse">
          <Rect width={cell * 2} height={cell * 2} fill="#1C2026" />
          <Rect width={cell} height={cell} fill="#262B33" />
          <Rect x={cell} y={cell} width={cell} height={cell} fill="#262B33" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#chk)" />
    </Svg>
  );
}
