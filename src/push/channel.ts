import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** The channel id MA23's FCM sender puts on every Android message (`internal/push/fcm.go`). */
export const JOB_UPDATES_CHANNEL = 'job_updates';

export interface ChannelDeps {
  os: string;
  setChannel(id: string, name: string): Promise<unknown>;
}

const realDeps: ChannelDeps = {
  os: Platform.OS,
  setChannel: (id, name) =>
    Notifications.setNotificationChannelAsync(id, {
      name,
      importance: Notifications.AndroidImportance.HIGH,
    }),
};

/**
 * Android only. `expo-notifications` creates the channel (RN Firebase does not); calling it again with a
 * new name renames it, so a language change just re-runs this. Must exist before the Android 13
 * permission dialog can appear.
 */
export async function ensureJobUpdatesChannel(
  name: string,
  deps: ChannelDeps = realDeps,
): Promise<void> {
  if (deps.os !== 'android') return;
  try {
    await deps.setChannel(JOB_UPDATES_CHANNEL, name);
  } catch {
    // never block startup on a channel
  }
}
