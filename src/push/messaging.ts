/**
 * Lazy wrapper over `@react-native-firebase/messaging` (modular API, v27). Same pattern as
 * `src/analytics/crashlytics.ts`: the native module is only linked when the build has a Firebase config
 * (`app.config.ts` pushes the plugin inside that guard), so nothing here touches it otherwise.
 * The FCM token is returned to the token module only; it is never logged or tracked.
 */
import { isFirebaseConfigured } from '@/lib/firebaseAvailable';

export type RemoteMessage = import('@react-native-firebase/messaging').RemoteMessage;
type MessagingModule = typeof import('@react-native-firebase/messaging');
type Messaging = ReturnType<MessagingModule['getMessaging']>;

let cached: { m: MessagingModule; inst: Messaging } | null = null;

function get(): { m: MessagingModule; inst: Messaging } | null {
  if (cached) return cached;
  if (!isFirebaseConfigured()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@react-native-firebase/messaging') as MessagingModule;
    cached = { m, inst: m.getMessaging() };
    return cached;
  } catch {
    return null;
  }
}

export const pushMessaging = {
  available: (): boolean => get() !== null,
  async getToken(): Promise<string | null> {
    const x = get();
    if (!x) return null;
    try {
      const token = await x.m.getToken(x.inst);
      return token || null;
    } catch {
      return null;
    }
  },
  async deleteToken(): Promise<void> {
    const x = get();
    if (!x) return;
    try {
      await x.m.deleteToken(x.inst);
    } catch {
      // best effort
    }
  },
  onTokenRefresh(cb: (token: string) => void): () => void {
    const x = get();
    return x ? x.m.onTokenRefresh(x.inst, cb) : () => undefined;
  },
  onMessage(cb: (m: RemoteMessage) => void): () => void {
    const x = get();
    return x ? x.m.onMessage(x.inst, cb) : () => undefined;
  },
  onNotificationOpenedApp(cb: (m: RemoteMessage) => void): () => void {
    const x = get();
    return x ? x.m.onNotificationOpenedApp(x.inst, cb) : () => undefined;
  },
  async getInitialNotification(): Promise<RemoteMessage | null> {
    const x = get();
    if (!x) return null;
    try {
      return await x.m.getInitialNotification(x.inst);
    } catch {
      return null;
    }
  },
  /** Module scope in the entry file (RN Firebase requirement). The OS shows the payload; we do nothing. */
  setBackgroundMessageHandler(): void {
    const x = get();
    if (!x) return;
    x.m.setBackgroundMessageHandler(x.inst, async () => undefined);
  },
};
