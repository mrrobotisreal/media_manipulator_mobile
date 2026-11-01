import { makeStore } from './store';

/** Builds a store and waits for redux-persist to finish rehydrating. */
export async function makeReadyStore() {
  const made = makeStore();
  await new Promise<void>((resolve) => {
    if (made.persistor.getState().bootstrapped) return resolve();
    const unsub = made.persistor.subscribe(() => {
      if (made.persistor.getState().bootstrapped) {
        unsub();
        resolve();
      }
    });
  });
  return made;
}
