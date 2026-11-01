import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { colors } from '../tokens';
import { Button } from './Button';
import { Text } from './Text';

export function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      {Icon ? <Icon size={32} color={colors.mutedFg} /> : null}
      <Text className="text-lg font-semibold">{title}</Text>
      {body ? <Text className="text-center text-muted-fg">{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" />
      ) : null}
    </View>
  );
}
