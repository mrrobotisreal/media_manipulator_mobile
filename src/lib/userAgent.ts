import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/** `<semver>+<build>`, also the analytics envelope `app_version` (MA07). */
export function appVersionString(): string {
  return `${Application.nativeApplicationVersion ?? '0.0.0'}+${Application.nativeBuildVersion ?? '0'}`;
}

let cached: string | null = null;

/**
 * `MediaManipulator/<semver>+<build> (<Android|iOS> <osVersion>; <model>)` (ADR MA-0004).
 * Replaces RN's default `okhttp/x` UA, which analytics flags as a bot.
 */
export function userAgent(): string {
  if (cached) return cached;
  const os = Platform.OS === 'ios' ? 'iOS' : 'Android';
  const osVersion = Device.osVersion ?? 'unknown';
  const model = Device.modelName ?? 'unknown';
  cached = `MediaManipulator/${appVersionString()} (${os} ${osVersion}; ${model})`;
  return cached;
}

/** Test seam. */
export function resetUserAgentCache(): void {
  cached = null;
}
