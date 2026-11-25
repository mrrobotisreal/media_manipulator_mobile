/**
 * MA60: eyedropper picks apply in tap order even when their async readbacks resolve out of order
 * (a tap then a fast long-press must not land add-then-replace the wrong way round).
 */
import { createPickQueue } from '../pickQueue';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('pickQueue', () => {
  it('applies in request order when the second read resolves first', async () => {
    const enqueue = createPickQueue();
    const a = deferred<string>();
    const b = deferred<string>();
    const applied: (string | null)[] = [];
    enqueue(a.promise, (v) => applied.push(v));
    const last = enqueue(b.promise, (v) => applied.push(v));
    b.resolve('second');
    await Promise.resolve();
    expect(applied).toEqual([]);
    a.resolve('first');
    await last;
    expect(applied).toEqual(['first', 'second']);
  });

  it('a failed read applies null and a throwing apply never stalls the queue', async () => {
    const enqueue = createPickQueue();
    const applied: (string | null)[] = [];
    enqueue(Promise.reject(new Error('readback')), (v) => applied.push(v));
    enqueue(Promise.resolve('x'), () => {
      throw new Error('apply');
    });
    await enqueue(Promise.resolve('y'), (v) => applied.push(v));
    expect(applied).toEqual([null, 'y']);
  });
});
