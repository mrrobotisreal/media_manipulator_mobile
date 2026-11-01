/**
 * Expo Router native-intent hook. expo-share-intent's iOS flow (MA36) opens `<scheme>://dataUrl=<key>`;
 * rewrite it to the intake route so the router never shows "not found". Android delivers ACTION_SEND
 * without a URL, so nothing arrives here for it; the intake screen redirects to Tools when no share is
 * pending.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=')) return '/intake';
  return path;
}
