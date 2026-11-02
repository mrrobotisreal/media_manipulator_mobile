import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import type { FaceBox } from '../options/ai';
import { hitArea, normToDisplay } from './overlayMath';

export interface FacePickerProps {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  faces: FaceBox[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * Tap the detected faces to choose them. Boxes are normalized to the oriented image and drawn over a
 * `contain`-fitted preview (so letterbox bars are accounted for); each box has at least a 44 pt hit area
 * even for a tiny face. The canvas is LTR; the labels around it follow the locale.
 */
export function FacePicker({
  uri,
  imageWidth,
  imageHeight,
  faces,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  disabled = false,
}: FacePickerProps) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const aspect = imageWidth / imageHeight;
  const chosen = new Set(selected);
  const onLayout = (e: LayoutChangeEvent) =>
    setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <Num className="text-sm text-muted-fg" testID="face-count">
          {faces.length === 0
            ? t('tools.ai.faces.none')
            : t('tools.ai.faces.found', { count: faces.length })}
        </Num>
      </View>
      {faces.length > 0 ? (
        <Text className="text-sm text-muted-fg">{t('tools.ai.faces.tapHint')}</Text>
      ) : null}
      <View
        testID="face-canvas"
        onLayout={onLayout}
        className="w-full overflow-hidden rounded-lg border border-edge bg-surface-0"
        style={{ aspectRatio: Math.min(2, Math.max(0.5, aspect)), direction: 'ltr' }}
      >
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          pointerEvents="none"
        />
        {faces.map((f, i) => {
          const d = normToDisplay(f, layout, aspect);
          const h = hitArea(d);
          const isSel = chosen.has(f.id);
          return (
            <Pressable
              key={f.id}
              testID={`face-${f.id}`}
              disabled={disabled}
              onPress={() => onToggle(f.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSel, disabled }}
              accessibilityLabel={t('tools.ai.faces.a11yFace', {
                index: f.index ?? i + 1,
                state: isSel ? t('tools.ai.faces.selected') : t('tools.ai.faces.notSelected'),
              })}
              style={{
                position: 'absolute',
                left: h.left,
                top: h.top,
                width: h.width,
                height: h.height,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  width: d.width,
                  height: d.height,
                  borderWidth: 2,
                  borderStyle: isSel ? 'solid' : 'dashed',
                  borderColor: isSel ? colors.primary : colors.edgeStrong,
                  backgroundColor: isSel ? 'rgba(255,107,74,0.2)' : 'transparent',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start',
                }}
              >
                {isSel ? <Check size={14} color={colors.primary} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {faces.length > 0 ? (
        <View className="flex-row gap-2">
          <Button
            variant="secondary"
            label={t('tools.ai.faces.selectAll')}
            disabled={disabled}
            onPress={onSelectAll}
          />
          <Button
            variant="secondary"
            label={t('tools.ai.faces.clear')}
            disabled={disabled}
            onPress={onClear}
          />
        </View>
      ) : null}
    </View>
  );
}
