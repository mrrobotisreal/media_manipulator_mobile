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
import { registerSessionDispatch } from '@/analytics/session';
import { registerStateGetter } from '@/api/stateRef';
import { setupApiListeners } from '@/api/listeners';
import { mmApi } from '@/api/mmApi';
import { authListener } from '@/auth/gate';
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
  [mmApi.reducerPath]: mmApi.reducer,
  settings: persistReducer(persistConfig('settings'), settings),
});

export function makeStore() {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] },
      }).concat(mmApi.middleware, authListener.middleware),
  });
  registerStateGetter(() => store.getState());
  registerSessionDispatch(store.dispatch);
  return { store, persistor: persistStore(store) };
}

export const { store, persistor } = makeStore();
setupApiListeners(store.dispatch);

export type RootState = ReturnType<typeof rootReducer>;
export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;
