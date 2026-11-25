/**
 * MA60 (coordinator review): the canvas render loop. Latest wins (one render in flight, a drag's
 * changes coalesce), a failure is reported once per document and retried, and nothing publishes
 * after stop.
 */
import { createRenderPump } from '../renderPump';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('renderPump', () => {
  it('keeps one render in flight and coalesces a drag into one pending pass on the latest doc', async () => {
    let doc = 'd0';
    const calls: { d: string; p: ReturnType<typeof deferred<string>> }[] = [];
    const published: string[] = [];
    const pump = createRenderPump<string, string>({
      get: () => doc,
      render: (d) => {
        const p = deferred<string>();
        calls.push({ d, p });
        return p.promise;
      },
      publish: (r) => published.push(r),
      report: jest.fn(),
    });
    pump.request();
    for (const d of ['d1', 'd2', 'd3', 'd4']) {
      doc = d;
      pump.request();
    }
    expect(calls.map((c) => c.d)).toEqual(['d0']);
    calls[0]!.p.resolve('r0');
    await flush();
    // One pending pass, on the latest doc: d1..d3 are never rendered.
    expect(calls.map((c) => c.d)).toEqual(['d0', 'd4']);
    calls[1]!.p.resolve('r4');
    await flush();
    expect(published).toEqual(['r0', 'r4']);
    // Same doc again: nothing to do.
    pump.request();
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('a failed render is reported once, retried, and the last picture stays until one succeeds', async () => {
    const doc = 'd0';
    const report = jest.fn();
    const published: string[] = [];
    let n = 0;
    const pump = createRenderPump<string, string>({
      get: () => doc,
      render: async () => {
        n += 1;
        if (n === 1) throw new Error('GPU readback failed');
        return 'ok';
      },
      publish: (r) => published.push(r),
      report,
    });
    pump.request();
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
    expect(n).toBe(2);
    expect(published).toEqual(['ok']);
  });

  it('a doc that keeps failing stops after maxAttempts (one report); the next doc tries again', async () => {
    let doc = 'bad';
    const report = jest.fn();
    const render = jest.fn(async (d: string) => {
      if (d === 'bad') throw new Error('boom');
      return d;
    });
    const published: string[] = [];
    const pump = createRenderPump<string, string>({
      get: () => doc,
      render,
      publish: (r) => published.push(r),
      report,
      maxAttempts: 2,
    });
    pump.request();
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    pump.request(); // same failing doc: not hammered
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
    doc = 'good';
    pump.request();
    await flush();
    expect(published).toEqual(['good']);
  });

  it('nothing publishes after stop (unmount mid-render)', async () => {
    const p = deferred<string>();
    const publish = jest.fn();
    const pump = createRenderPump<string, string>({
      get: () => 'd0',
      render: () => p.promise,
      publish,
      report: jest.fn(),
    });
    pump.request();
    pump.stop();
    p.resolve('late');
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it('a throwing reporter never breaks the loop', async () => {
    let first = true;
    const publish = jest.fn();
    const pump = createRenderPump<string, string>({
      get: () => 'd0',
      render: async () => {
        if (first) {
          first = false;
          throw new Error('x');
        }
        return 'ok';
      },
      publish,
      report: () => {
        throw new Error('reporter');
      },
    });
    pump.request();
    await flush();
    expect(publish).toHaveBeenCalledWith('ok', 'd0');
  });
});
