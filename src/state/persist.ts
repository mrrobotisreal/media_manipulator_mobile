import { createMMKV } from 'react-native-mmkv';
import type { Storage } from 'redux-persist';

// The only place MMKV is imported; callers use `mmkvStorage` (react-native-mmkv v4 / Nitro).
const mmkv = createMMKV({ id: 'mm-app' });

export const mmkvStorage: Storage = {
  setItem: (key, value) => {
    mmkv.set(key, value);
    return Promise.resolve(true);
  },
  getItem: (key) => Promise.resolve(mmkv.getString(key)),
  removeItem: (key) => {
    mmkv.remove(key);
    return Promise.resolve();
  },
};

export const persistConfig = (key: string) => ({ key, storage: mmkvStorage });

/** MMKV instance ids the app owns: redux-persist (`mm-app`) and the analytics outbox (`mm-analytics`). */
export const MMKV_INSTANCE_IDS = ['mm-app', 'mm-analytics'] as const;

/**
 * Account deletion (MA22): erases every key of every app MMKV instance. Callers pause redux-persist
 * first and stop the analytics flush timers, or the old state is written back / flushed.
 */
export function wipeAllStorage(): void {
  for (const id of MMKV_INSTANCE_IDS) {
    try {
      (id === 'mm-app' ? mmkv : createMMKV({ id })).clearAll();
    } catch {
      // best effort: a failed wipe must not strand the confirmation screen
    }
  }
}
