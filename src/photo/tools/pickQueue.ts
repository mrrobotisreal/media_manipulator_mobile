/**
 * Applies async results in request order (MA60: the eyedropper's readback is a promise on
 * react-native-skia 3). Every read starts at once; each `apply` runs only after the previous one
 * has, whatever order the reads resolve in. A failed read applies `null`, never stalls the queue.
 */
export function createPickQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(read: Promise<T>, apply: (v: T | null) => void): Promise<void> {
    const r = read.catch(() => null);
    tail = tail.then(async () => {
      try {
        apply(await r);
      } catch {
        // one failed apply never blocks the next pick
      }
    });
    return tail;
  };
}
