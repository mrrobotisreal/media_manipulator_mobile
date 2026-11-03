import * as Device from 'expo-device';
import { NetworkStateType } from 'expo-network';
import { Platform } from 'react-native';
import { getActiveLocale } from '@/i18n';

/** A context or property bag; `undefined` members are dropped before sending. */
export type EventProps = Record<string, string | number | boolean | null | undefined>;

export type ConnectionType = 'wifi' | 'cellular' | 'none' | 'unknown';

/** expo-network type -> the four values we report (**proposed**: ethernet/vpn/... are `unknown`). */
export function connectionTypeOf(type: NetworkStateType | undefined): ConnectionType {
  switch (type) {
    case NetworkStateType.WIFI:
      return 'wifi';
    case NetworkStateType.CELLULAR:
      return 'cellular';
    case NetworkStateType.NONE:
      return 'none';
    default:
      return 'unknown';
  }
}

let connection: ConnectionType = 'unknown';
let screen: string | null = null;

export function setConnectionType(c: ConnectionType): void {
  connection = c;
}

/** The current route pattern (`screen_viewed.screen`), also sent as `context.pathname`. */
export function setScreen(pattern: string): void {
  screen = pattern;
}

export function currentScreen(): string | null {
  return screen;
}

/**
 * Ambient context (`tool_slug`, `media_kind` while a tool screen is open — the web
 * ToolAnalyticsContext precedent, MA10).
 */
const ambient: EventProps = {};

export function setContext(patch: EventProps): void {
  Object.assign(ambient, patch);
}

export function clearContext(keys: string[]): void {
  for (const k of keys) delete ambient[k];
}

export function getContext(): EventProps {
  return { ...ambient };
}

/** Batch-level context: the device. Never a URL, file name or user name. */
export function deviceContext(): EventProps {
  const os = Platform.OS === 'ios' ? 'iOS' : 'Android';
  return {
    device_type: Device.deviceType === Device.DeviceType.TABLET ? 'tablet' : 'mobile',
    os: Device.osVersion ? `${os} ${Device.osVersion}` : os,
    timezone: safeTimezone(),
  };
}

/** Per-event context at track time: locale, connection, current screen and ambient tool context. */
export function eventContext(tier: string | undefined): EventProps {
  return {
    locale: getActiveLocale(),
    connection_type: connection,
    ...(tier ? { tier } : {}),
    ...(screen ? { pathname: screen } : {}),
    ...ambient,
  };
}

function safeTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Test seam. */
export function resetContextForTests(): void {
  connection = 'unknown';
  screen = null;
  for (const k of Object.keys(ambient)) delete ambient[k];
}
