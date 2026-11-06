import type { AssistantStreamEvent } from '@/api/schemas/assistant';
import { streamChat, ChatNetworkError, type ChatFetch, type ChatStreamDeps } from '../chatStream';
import {
  ERROR_SSE,
  FULL_ANSWER_EVENTS,
  FULL_ANSWER_SSE,
  MALFORMED_SSE,
  STATIC_SSE,
} from '../__fixtures__/sse';

const enc = new TextEncoder();

/** A body that yields `chunks`, then ends (or throws `failWith` after them). */
function body(chunks: string[], failWith?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]!));
      else if (failWith) c.error(failWith);
      else c.close();
    },
  });
}

const ok = (b: ReadableStream<Uint8Array>) => ({
  ok: true,
  status: 200,
  body: b,
  text: async () => '',
});
const refuse = (status: number, json: unknown) => ({
  ok: false,
  status,
  body: null,
  text: async () => JSON.stringify(json),
});

const BODY = {
  surface: 'guide' as const,
  locale: 'en-US',
  page: { path: '/tools' },
  message: { text: 'gif?' },
};

function setup(fetchImpl: jest.Mock, extra: Partial<ChatStreamDeps> = {}) {
  const events: AssistantStreamEvent[] = [];
  const deps: ChatStreamDeps = {
    streamFetch: fetchImpl as unknown as ChatFetch,
    buildHeaders: async () => ({
      'X-MM-Session-ID': 's',
      'X-MM-Visitor-ID': 'v',
      Accept: 'application/json',
    }),
    baseUrl: 'https://api.test/api',
    sleep: async () => undefined,
    ...extra,
  };
  const run = (signal?: AbortSignal) => streamChat(deps, BODY, (e) => events.push(e), signal);
  return { events, run };
}

describe('streamChat (MA54 S1)', () => {
  it('parses every SSE event type, in order, ignoring pings', async () => {
    const f = jest.fn().mockResolvedValue(ok(body([FULL_ANSWER_SSE])));
    const { events, run } = setup(f);
    await run();
    expect(events.map((e) => e.type)).toEqual(
      FULL_ANSWER_EVENTS.map((e) => (e as { type: string }).type),
    );
    expect(events.find((e) => e.type === 'action')).toMatchObject({
      kind: 'open_tool',
      params: { slug: 'convert-video-to-animated-gif', preset: 'mp4-to-gif' },
    });
  });

  it('parses the stream however the bytes are chunked', async () => {
    for (const size of [1, 3, 17, 64]) {
      const chunks = FULL_ANSWER_SSE.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!;
      const f = jest.fn().mockResolvedValue(ok(body(chunks)));
      const { events, run } = setup(f);
      await run();
      expect(events).toHaveLength(FULL_ANSWER_EVENTS.length);
    }
  });

  it('POSTs the JSON body to /assistant/chat with the identity headers and SSE accept', async () => {
    const f = jest.fn().mockResolvedValue(ok(body(['data: {"type":"done"}\n\n'])));
    await setup(f).run();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/assistant/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'X-MM-Session-ID': 's',
      'X-MM-Visitor-ID': 'v',
    });
    expect(JSON.parse(init.body)).toEqual(BODY);
  });

  it('drops the visitor id when analytics is opted out', async () => {
    const f = jest.fn().mockResolvedValue(ok(body(['data: {"type":"done"}\n\n'])));
    await setup(f, { analyticsOptedOut: () => true }).run();
    expect(f.mock.calls[0]![1].headers['X-MM-Visitor-ID']).toBeUndefined();
    expect(f.mock.calls[0]![1].headers['X-MM-Session-ID']).toBe('s');
  });

  it('drops malformed JSON, unknown event types and unknown action kinds', async () => {
    const f = jest.fn().mockResolvedValue(ok(body([MALFORMED_SSE])));
    const { events, run } = setup(f);
    await run();
    expect(events).toEqual([{ type: 'delta', text: 'ok' }, { type: 'done' }]);
  });

  it('delivers the static answer (done.outcome) and an in-stream error', async () => {
    const s = setup(jest.fn().mockResolvedValue(ok(body([STATIC_SSE]))));
    await s.run();
    expect(s.events.at(-1)).toEqual({ type: 'done', outcome: 'static' });
    const e = setup(jest.fn().mockResolvedValue(ok(body([ERROR_SSE]))));
    await e.run();
    expect(e.events.at(-1)).toMatchObject({ type: 'error', code: 'upstream' });
  });

  it.each([
    [429, { error: 'quota_exceeded' }, 'limit'],
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [401, { error: 'sign_in_required' }, 'sign_in_required'],
    [404, { error: 'not_found' }, 'not_found'],
    [503, { error: 'assistant_paused' }, 'assistant_paused'],
    [413, { error: 'body_too_large' }, 'body_too_large'],
    [500, {}, 'http_500'],
  ])('pre-stream %i %j becomes an error event %s (no retry)', async (status, json, code) => {
    const f = jest.fn().mockResolvedValue(refuse(status, json));
    const { events, run } = setup(f);
    await run();
    expect(events).toEqual([{ type: 'error', code, message: `HTTP ${status}` }]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries once on a network drop before the first byte, then succeeds', async () => {
    const f = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(ok(body(['data: {"type":"done"}\n\n'])));
    const { events, run } = setup(f);
    await run();
    expect(f).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('gives up after the one retry (ChatNetworkError)', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const { run } = setup(f);
    await expect(run()).rejects.toBeInstanceOf(ChatNetworkError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry once a byte arrived: the drop is final and earlier events were delivered', async () => {
    const f = jest
      .fn()
      .mockResolvedValue(ok(body(['data: {"type":"delta","text":"hi"}\n\n'], new Error('reset'))));
    const { events, run } = setup(f);
    await expect(run()).rejects.toBeInstanceOf(ChatNetworkError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: 'delta', text: 'hi' }]);
  });

  it('aborts mid-stream: rejects with AbortError and delivers nothing more', async () => {
    const ac = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let step = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        step++;
        if (step === 1) {
          c.enqueue(enc.encode('data: {"type":"delta","text":"a"}\n\n'));
          return;
        }
        await gate;
        if (step === 2) c.enqueue(enc.encode('data: {"type":"delta","text":"b"}\n\n'));
        else c.close();
      },
    });
    const f = jest.fn().mockImplementation((_u, init) => {
      init.signal.addEventListener('abort', () => release());
      return Promise.resolve(ok(stream));
    });
    const { events, run } = setup(f);
    const p = run(ac.signal);
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.map((e) => (e as { text?: string }).text)).toEqual(['a']);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
  });

  it('an already-aborted signal never retries and rejects with AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    const f = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    const { run } = setup(f);
    await expect(run(ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
