import { Platform } from 'react-native';
import type { AppDispatch } from '@/state/store';
import { pushTokensApi } from '@/api/endpoints/pushTokens';
import { getAppState } from '@/api/stateRef';
import { getRequestLocale } from '@/lib/locale';
import { appVersionString } from '@/lib/userAgent';
import { pushMessaging } from './messaging';
import { getPermissionState } from './permission';
import { createTokenManager, type RegisterOutcome } from './token';

let dispatchRef: AppDispatch | null = null;

/** The store's dispatch (the root host and `performSignOut` pass it; this module never imports the store). */
export function bindPushDispatch(d: AppDispatch): void {
  dispatchRef = d;
}

async function call(run: (d: AppDispatch) => Promise<unknown>): Promise<RegisterOutcome> {
  if (!dispatchRef) return 'failed';
  try {
    await run(dispatchRef);
    return 'ok';
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    return status === 409 ? 'not_synced' : 'failed';
  }
}

export const tokenManager = createTokenManager({
  permission: () => getPermissionState(),
  getToken: () => pushMessaging.getToken(),
  deleteToken: () => pushMessaging.deleteToken(),
  platform: () => (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null),
  appVersion: () => appVersionString(),
  locale: () => {
    const s = getAppState();
    return s ? getRequestLocale(s) : 'en-US';
  },
  register: (body) =>
    call((d) => d(pushTokensApi.endpoints.registerPushToken.initiate(body)).unwrap()),
  unregister: async (token) => {
    await call((d) => d(pushTokensApi.endpoints.unregisterPushToken.initiate({ token })).unwrap());
  },
});

/** `performSignOut` hook: `server:false` when the Bearer is gone (session expired, account deleted). */
export function releasePushToken(dispatch: AppDispatch, opts: { server: boolean }): Promise<void> {
  bindPushDispatch(dispatch);
  return tokenManager.release(opts);
}
