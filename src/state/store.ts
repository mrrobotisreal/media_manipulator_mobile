import { combineReducers, configureStore } from '@reduxjs/toolkit';
import {
  FLUSH,
  PAUSE,
  PERSIST,
  persistReducer,
  persistStore,
  PURGE,
  REGISTER,
  REHYDRATE,
} from 'redux-persist';
import { registerStateGetter } from '@/api/stateRef';
import { persistConfig } from './persist';
import auth from './slices/auth';
import jobs from './slices/jobs';
import quota from './slices/quota';
import session from './slices/session';
import settings from './slices/settings';

// Server data never goes in slices (RTK Query, MA03). auth and quota are not persisted.
export const rootReducer = combineReducers({
  auth,
  session: persistReducer(persistConfig('session'), session),
  jobs: persistReducer(persistConfig('jobs'), jobs),
  quota,
  settings: persistReducer(persistConfig('settings'), settings),
});

export function makeStore() {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] },
      }),
  });
  registerStateGetter(() => store.getState());
  return { store, persistor: persistStore(store) };
}

export const { store, persistor } = makeStore();

export type RootState = ReturnType<typeof rootReducer>;
export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;
