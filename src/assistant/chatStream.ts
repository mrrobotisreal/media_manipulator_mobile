import type { buildHeaders as BuildHeaders } from '@/api/baseQuery';
import {
  assistantStreamEventSchema,
  type AssistantChatBody,
  type AssistantStreamEvent,
} from '@/api/schemas/assistant';
import { createSseParser } from '@/jobs/sseParser';

/** `expo/fetch` shape this client needs (the jobs transport's `StreamFetch` plus method and body). */
export type ChatFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}>;

export interface ChatStreamDeps {
  streamFetch: ChatFetch;
  buildHeaders: typeof BuildHeaders;
  /** `${API_BASE_URL}` (ends in /api). */
  baseUrl: string;
  /** True when the user turned analytics off: the visitor id header is then not sent (the web's consent rule). */
  analyticsOptedOut?: () => boolean;
  /** Pause before the single retry. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Thrown for a network failure after the stream began (or after the one retry); aborts reject with `AbortError`. */
export class ChatNetworkError extends Error {
  constructor(message = 'network') {
    super(message);
    this.name = 'ChatNetworkError';
  }
}

/** Pre-stream refusal codes callers branch on (beside the API's in-stream `error.code`s). */
export type ChatRefusal =
  'limit' | 'rate_limited' | 'sign_in_required' | 'assistant_paused' | 'not_found' | string;

export function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

async function refusalCode(res: { status: number; text(): Promise<string> }): Promise<ChatRefusal> {
  let code = '';
  try {
    const b = JSON.parse(await res.text()) as { error?: unknown };
    if (typeof b.error === 'string') code = b.error;
  } catch {
    // not JSON
  }
  if (res.status === 429) return code === 'quota_exceeded' ? 'limit' : 'rate_limited';
  if (res.status === 401) return 'sign_in_required';
  if (res.status === 404) return 'not_found';
  if (code === 'assistant_paused') return 'assistant_paused';
  return code && /^[a-z_]{2,40}$/.test(code) ? code : `http_${res.status}`;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `POST {API}/assistant/chat` over `expo/fetch` streaming (ticket MA54 decision 3). Every parsed event
 * goes to `onEvent` in order; a malformed or unknown frame is dropped. Resolves when the stream ends.
 * Rejects with `AbortError` when `signal` aborts, with `ChatNetworkError` on a network failure.
 *
 * A pre-stream refusal (401, 404, 429, 503...) becomes a synthetic `{type:'error', code}` event so
 * callers have one path. A network failure BEFORE the first byte is retried exactly once (the guide is
 * free and a failed attempt stored nothing); after the first byte the failure is final. Never polls.
 */
export async function streamChat(
  deps: ChatStreamDeps,
  body: AssistantChatBody,
  onEvent: (ev: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const sleep = deps.sleep ?? wait;
  const payload = JSON.stringify(body);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    for (let attempt = 0; ; attempt++) {
      let gotByte = false;
      try {
        await once(deps, payload, onEvent, controller.signal, () => {
          gotByte = true;
        });
        if (controller.signal.aborted) throw abortError();
        return;
      } catch (e) {
        if (controller.signal.aborted || isAbortError(e)) throw abortError();
        if (gotByte || attempt >= 1) {
          throw e instanceof ChatNetworkError ? e : new ChatNetworkError(String(e));
        }
        await sleep(deps.retryDelayMs ?? 600);
        if (controller.signal.aborted) throw abortError();
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

async function once(
  deps: ChatStreamDeps,
  payload: string,
  onEvent: (ev: AssistantStreamEvent) => void,
  signal: AbortSignal,
  markByte: () => void,
): Promise<void> {
  const headers = await deps.buildHeaders();
  headers.Accept = 'text/event-stream';
  headers['Content-Type'] = 'application/json';
  if (deps.analyticsOptedOut?.()) delete headers['X-MM-Visitor-ID'];
  const res = await deps.streamFetch(`${deps.baseUrl}/assistant/chat`, {
    method: 'POST',
    headers,
    body: payload,
    signal,
  });
  if (!res.ok) {
    onEvent({ type: 'error', code: await refusalCode(res), message: `HTTP ${res.status}` });
    return;
  }
  if (!res.body) throw new ChatNetworkError('no_stream');
  const decoder = new TextDecoder();
  const parser = createSseParser((m) => {
    if (signal.aborted) return; // nothing is delivered after Stop / close
    let json: unknown;
    try {
      json = JSON.parse(m.data);
    } catch {
      return;
    }
    const parsed = assistantStreamEventSchema.safeParse(json);
    if (parsed.success) onEvent(parsed.data);
  });
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) break;
    if (value) {
      markByte();
      parser.push(decoder.decode(value, { stream: true }));
    }
  }
}
