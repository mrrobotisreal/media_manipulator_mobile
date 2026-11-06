import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Medi's mark (web `public/medi-mark.svg`, 32x32): a rounded tile with an M stroke and a coral dot. */
export function MediMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" accessibilityElementsHidden>
      <Rect
        x={1}
        y={1}
        width={30}
        height={30}
        rx={9}
        fill="#131519"
        stroke="#FF6B4A"
        strokeWidth={2}
      />
      <Path
        d="M8.5 22V10.5l7.5 8 7.5-8V22"
        stroke="#E6E9EE"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={24.5} cy={7.5} r={2.5} fill="#FF6B4A" />
    </Svg>
  );
}
