import type { Href } from 'expo-router';

/** Opens My voices. Lazy: keeps expo-router out of every test that only imports the registry (ApertureLauncher's rule). */
export function openMyVoices(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { router } = require('expo-router') as typeof import('expo-router');
  router.push('/(app)/(tabs)/account/voices' as Href);
}
