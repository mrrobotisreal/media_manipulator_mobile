import { Redirect } from 'expo-router';
import { useAppSelector } from '@/state/hooks';

export default function NotFound() {
  const status = useAppSelector((s) => s.auth.status);
  return <Redirect href={status === 'ready' ? '/(app)/(tabs)' : '/(auth)/sign-in'} />;
}
