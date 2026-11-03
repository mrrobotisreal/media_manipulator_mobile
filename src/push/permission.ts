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

const fromStatus = (s: Notifications.PermissionStatus): PermissionState =>
  s === Notifications.PermissionStatus.GRANTED
    ? 'granted'
    : s === Notifications.PermissionStatus.DENIED
      ? 'denied'
      : 'undetermined';

const realDeps: PermissionDeps = {
  os: Platform.OS,
  version: Platform.Version,
  getStatus: async () => fromStatus((await Notifications.getPermissionsAsync()).status),
  request: async () => fromStatus((await Notifications.requestPermissionsAsync()).status),
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
