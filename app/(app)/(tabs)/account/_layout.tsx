import { Stack } from 'expo-router';
import { colors } from '@/ui/tokens';

/** The Account tab is a stack: overview, then one screen per settings area (ARCHITECTURE §1). */
export default function AccountLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface0 } }}
    />
  );
}
