import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';
import { colors, hitTarget } from '../tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BG: Record<ButtonVariant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-surface-2 border border-edge-control',
  ghost: 'bg-transparent',
  danger: 'bg-danger',
};
const FG: Record<ButtonVariant, string> = {
  primary: 'text-on-primary',
  secondary: 'text-foreground',
  ghost: 'text-foreground',
  danger: 'text-on-primary',
};

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  loading?: boolean;
  /** Haptic tap; callers pass settings.haptics. */
  haptics?: boolean;
  /** Decorative mark before the label (e.g. a provider logo), 8px gap. */
  icon?: ReactNode;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  haptics = false,
  icon,
  disabled,
  onPress,
  ...rest
}: ButtonProps) {
  const inactive = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={(e) => {
        if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      className={`items-center justify-center rounded-md px-4 ${BG[variant]} ${inactive ? 'opacity-50' : ''}`}
      style={{ minHeight: size === 'lg' ? 52 : hitTarget }}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors.foreground} />
      ) : icon ? (
        <View className="flex-row items-center gap-2">
          {icon}
          <Text className={`font-semibold ${FG[variant]}`}>{label}</Text>
        </View>
      ) : (
        <Text className={`font-semibold ${FG[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
