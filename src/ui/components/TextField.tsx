import { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { colors, hitTarget } from '../tokens';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  helper?: string;
  error?: string | null;
}

/** Labelled input. Logical styles only; the error replaces the helper line. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helper, error, ...rest },
  ref,
) {
  return (
    <View className="gap-1">
      <Text className="text-sm text-muted-fg">{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.subtle}
        className={`rounded-md border bg-surface-1 px-3 font-sans text-foreground ${
          error ? 'border-danger' : 'border-edge-control'
        }`}
        style={{ minHeight: hitTarget, textAlign: 'auto' }}
        {...rest}
      />
      {error ? (
        <Text className="text-sm text-danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text className="text-sm text-subtle">{helper}</Text>
      ) : null}
    </View>
  );
});
