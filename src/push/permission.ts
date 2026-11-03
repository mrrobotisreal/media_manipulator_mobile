import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface PermissionDeps {
  os: string;
  /** `Platform.Version`: the API level on Android. */
  version: string | number;
  getStatus(): Promise<PermissionState>;
  request(): Promise<PermissionState>;
}

/**
 * Android 13+ reports a never-asked POST_NOTIFICATIONS as `denied` with `canAskAgain: true` (seen on the S25,
 * 2026-11-03); only `denied` without `canAskAgain` is the user's "Don't allow". The former is undetermined:
 * the pre-prompt may still ask.
 */
export const fromResponse = (r: {
  status: Notifications.PermissionStatus;
  canAskAgain?: boolean;
}): PermissionState => {
  if (r.status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (r.status === Notifications.PermissionStatus.DENIED && r.canAskAgain === false)
    return 'denied';
  return 'undetermined';
};

const realDeps: PermissionDeps = {
  os: Platform.OS,
  version: Platform.Version,
  getStatus: async () => fromResponse(await Notifications.getPermissionsAsync()),
  // After the dialog a refusal is final for the auto-ask rule (30-day re-ask is promptFlow's), whatever canAskAgain says.
  request: async () => {
    const r = await Notifications.requestPermissionsAsync();
    return r.status === Notifications.PermissionStatus.GRANTED ? 'granted' : 'denied';
  },
};

/** Android below 13 (API 33) allows notifications by default: no runtime permission, no prompt. */
export const needsRuntimePermission = (d: Pick<PermissionDeps, 'os' | 'version'>): boolean =>
  d.os !== 'android' || Number(d.version) >= 33;

export async function getPermissionState(
  deps: PermissionDeps = realDeps,
): Promise<PermissionState> {
  if (!needsRuntimePermission(deps)) return 'granted';
  try {
    return await deps.getStatus();
  } catch {
    return 'undetermined';
  }
}

/** The OS dialog. Resolves true when granted. */
export async function requestPermission(deps: PermissionDeps = realDeps): Promise<boolean> {
  if (!needsRuntimePermission(deps)) return true;
  try {
    return (await deps.request()) === 'granted';
  } catch {
    return false;
  }
}
