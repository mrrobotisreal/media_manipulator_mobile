import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { hitTarget } from '../tokens';

/** Shared with MA19 waveform colours (ticket decision 5). No free colour picker in v1. */
export const SWATCHES = [
  '#FFFFFF',
  '#000000',
  '#FF6B4A',
  '#5EEAD4',
  '#FFC857',
  '#4ADE80',
  '#F4525C',
  '#8B95A5',
] as const;

export function Swatches({
  value,
  onChange,
  colors = SWATCHES,
}: {
  value: string;
  onChange: (hex: string) => void;
  colors?: readonly string[];
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row flex-wrap gap-2">
      {colors.map((hex) => {
        const selected = hex.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={hex}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t('toolUi.color.a11y', { hex })}
            onPress={() => onChange(hex)}
            className={`rounded-full border-2 ${selected ? 'border-primary' : 'border-edge-control'}`}
            style={{ width: hitTarget, height: hitTarget, padding: 4 }}
          >
            <View className="flex-1 rounded-full" style={{ backgroundColor: hex }} />
          </Pressable>
        );
      })}
    </View>
  );
}
