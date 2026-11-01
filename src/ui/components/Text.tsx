import { Text as RNText, type TextProps } from 'react-native';

export function Text({ className = '', ...rest }: TextProps & { className?: string }) {
  return <RNText className={`font-sans text-foreground ${className}`} {...rest} />;
}

/** Every number renders in JetBrains Mono with tabular figures. */
export function Num({ className = '', style, ...rest }: TextProps & { className?: string }) {
  return (
    <RNText
      className={`font-mono text-foreground ${className}`}
      style={[{ fontVariant: ['tabular-nums'] }, style]}
      {...rest}
    />
  );
}
