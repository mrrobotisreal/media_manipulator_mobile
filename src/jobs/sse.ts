import type { buildHeaders as BuildHeaders } from '@/api/baseQuery';
import { networkError, normaliseError } from '@/api/errors';
import { conversionJobSchema } from '@/api/schemas/job';
import { createSseParser } from './sseParser';
import type { EventHandlers, StreamFetch } from './transport';

export interface SseDeps {
  streamFetch: StreamFetch;
  buildHeaders: typeof BuildHeaders;
  baseUrl: string;
  getSessionId: () => string;
}

/**
 * `GET {API}/job/:id/events?sid=<sessionId>` over `expo/fetch` streaming (decision 10). The URL
 * carries `?sid=` (the documented credential for streams, MA-0005) and the request also carries
 * the owner headers. Returns `close()`, which aborts the request; after close no handler fires.
 */
export function createJobEventStream(
  deps: SseDeps,
  jobId: string,
  h: EventHandlers,
): { close(): void } {
  const controller = new AbortController();
  let closed = false;
  const live =
    <T extends unknown[]>(fn: (...a: T) => void) =>
    (...a: T) => {
      if (!closed) fn(...a);
    };
  const onSnapshot = live(h.onSnapshot);
  const onActivity = live(h.onActivity);
  const onError = live(h.onError);
  const onClose = live(h.onClose);

  void (async () => {
    try {
      const headers = await deps.buildHeaders();
      headers.Accept = 'text/event-stream';
      const url = `${deps.baseUrl}/job/${encodeURIComponent(jobId)}/events?sid=${encodeURIComponent(deps.getSessionId())}`;
      const res = await deps.streamFetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        let body: unknown;
        try {
          body = JSON.parse(await res.text());
        } catch {
          body = undefined;
        }
        return onError(normaliseError(res.status, body, res.headers));
      }
      if (!res.body) return onError(networkError('no_stream'));
      onActivity();
      const decoder = new TextDecoder();
      const parser = createSseParser(
        (m) => {
          if (m.event !== 'update') return onActivity();
          try {
            const parsed = conversionJobSchema.safeParse(JSON.parse(m.data));
            if (parsed.success) onSnapshot(parsed.data);
            else onActivity();
          } catch {
            onActivity();
          }
        },
        () => onActivity(),
      );
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) parser.push(decoder.decode(value, { stream: true }));
      }
      onClose();
    } catch (e) {
      onError(networkError(e instanceof Error ? e.message : undefined));
    }
  })();

  return {
    close() {
      closed = true;
      controller.abort();
    },
  };
}
