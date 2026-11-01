import { setIdTokenProvider } from '@/api/authToken';
import { registerAccountInvalidator } from '@/api/baseQuery';
import { mmApi } from '@/api/mmApi';
import { makeReadyStore } from '@/state/testing';
import {
  createJobTransport,
  type MakeTaskOptions,
  type StreamFetch,
  type UploadTaskLike,
} from './transport';

export interface TaskCall {
  uri: string;
  url: string;
  opts: MakeTaskOptions;
  cancelled: boolean;
}

export interface FetchCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

export type TaskReply =
  { status: number; headers?: Record<string, string>; body?: unknown } | Error;
export type FetchReply = { status: number; body?: unknown; headers?: Record<string, string> };

/** A real store + RTK Query, a faked global fetch (JSON endpoints), a fake upload task and stream fetch. */
export async function makeHarness(opts: { taskReplies?: TaskReply[]; platform?: string } = {}) {
  const { store } = await makeReadyStore();
  registerAccountInvalidator(() => mmApi.util.invalidateTags(['Account']));
  setIdTokenProvider(() => Promise.resolve('tok'));
  const dispatched: { type: string }[] = [];
  const dispatch = ((a: { type: string }) => {
    if (typeof a === 'object') dispatched.push(a);
    return (store.dispatch as (x: unknown) => unknown)(a);
  }) as typeof store.dispatch;

  const tasks: TaskCall[] = [];
  const taskReplies = [...(opts.taskReplies ?? [])];
  const makeTask = (uri: string, url: string, o: MakeTaskOptions): UploadTaskLike => {
    const call: TaskCall = { uri, url, opts: o, cancelled: false };
    tasks.push(call);
    return {
      cancel: () => {
        call.cancelled = true;
      },
      uploadAsync: async () => {
        o.onProgress({ bytesSent: 50, totalBytes: 100 });
        const r = taskReplies.shift() ?? { status: 200, body: { jobId: 'job-1' } };
        if (r instanceof Error) throw r;
        return {
          status: r.status,
          headers: r.headers ?? {},
          body: r.body === undefined ? '' : JSON.stringify(r.body),
        };
      },
    };
  };

  const fetches: FetchCall[] = [];
  const fetchReplies: FetchReply[] = [];
  global.fetch = jest.fn((url: string, init: FetchCall['init']) => {
    fetches.push({ url, init });
    const r = fetchReplies.shift() ?? { status: 500 };
    return Promise.resolve({
      status: r.status,
      headers: new Headers(r.headers),
      text: () => Promise.resolve(r.body === undefined ? '' : JSON.stringify(r.body)),
    });
  }) as unknown as typeof fetch;

  const streamCalls: { url: string; headers: Record<string, string> }[] = [];
  let streamImpl: StreamFetch = () => Promise.reject(new Error('no stream'));
  const streamFetch: StreamFetch = (url, init) => {
    streamCalls.push({ url, headers: init.headers });
    return streamImpl(url, init);
  };

  const transport = createJobTransport({
    dispatch,
    makeTask,
    streamFetch,
    getSessionId: () => store.getState().session.sessionId,
    platform: opts.platform ?? 'android',
  });
  return {
    store,
    transport,
    tasks,
    fetches,
    fetchReplies,
    dispatched,
    streamCalls,
    setStream(fn: StreamFetch) {
      streamImpl = fn;
    },
  };
}

export const realFetch = global.fetch;
export function teardownHarness() {
  global.fetch = realFetch;
  setIdTokenProvider(() => Promise.resolve(null));
}

/** A ReadableStream that yields the given text chunks, then closes (or errors). */
export function textStream(chunks: string[], errorAfter?: Error): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else if (errorAfter) c.error(errorAfter);
      else c.close();
    },
  });
}
