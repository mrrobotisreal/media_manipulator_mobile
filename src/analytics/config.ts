import { Platform } from 'react-native';
import pkg from '../../package.json';

/** EAS env per profile (MA01 phase C): mobile-dev key for development/preview, mobile key for production. */
export const ANALYTICS_WRITE_KEY = process.env.EXPO_PUBLIC_ANALYTICS_WRITE_KEY ?? '';
export const ANALYTICS_BASE_URL = (
  process.env.EXPO_PUBLIC_ANALYTICS_BASE_URL ?? 'https://analytics.media-manipulator.com'
).replace(/\/+$/, '');

export const SDK = { name: 'mm-app', version: pkg.version } as const;

export const appPlatform = (): 'android' | 'ios' => (Platform.OS === 'ios' ? 'ios' : 'android');
