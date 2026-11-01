import { Redirect, Stack } from 'expo-router';
import { useAppSelector } from '@/state/hooks';

export default function AppLayout() {
  const status = useAppSelector((s) => s.auth.status);
  if (status !== 'ready') return <Redirect href="/(auth)/sign-in" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
