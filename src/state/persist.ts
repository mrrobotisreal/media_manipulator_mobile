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
