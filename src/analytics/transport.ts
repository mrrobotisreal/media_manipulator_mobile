import type { EventProps } from './context';
import type { WireEvent } from './outbox';

/** Our caps; the server's are 100 events / 512 KB per request. */
export const BATCH_MAX_EVENTS = 100;
export const BATCH_MAX_BYTES = 60_000;
export const MAX_SEND_ATTEMPTS = 5;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface TransportConfig {
  baseUrl: string;
  writeKey: string;
  userAgent: string;
  platform: 'android' | 'ios';
  appVersion: string;
  sdk: { name: string; version: string };
  deviceContext: () => EventProps;
  fetch: typeof fetch;
  now: () => number;
  log?: (msg: string, detail?: unknown) => void;
}

/** What the client does with a batch after one POST. */
export type SendOutcome =
  | { kind: 'done'; accepted: number; rejected: number }
  | { kind: 'drop'; status: number }
  | { kind: 'retry'; status: number | 'network' };

const strip = ({ priority: _p, ...e }: WireEvent) => e;

export function buildEnvelope(cfg: TransportConfig, events: readonly WireEvent[]) {
  return {
    write_key: cfg.writeKey,
    sent_at: new Date(cfg.now()).toISOString(),
    sdk: cfg.sdk,
    app_version: cfg.appVersion,
    platform: cfg.platform,
    context: cfg.deviceContext(),
    events: events.map(strip),
  };
}

/** Greedy split: ≤ 100 events and ≤ 60 KB of serialized events per batch (an oversize event goes alone). */
export function splitBatches(events: readonly WireEvent[]): WireEvent[][] {
  const out: WireEvent[][] = [];
  let cur: WireEvent[] = [];
  let bytes = 0;
  for (const e of events) {
    const s = JSON.stringify(strip(e)).length + 1;
    if (cur.length && (cur.length >= BATCH_MAX_EVENTS || bytes + s > BATCH_MAX_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Exponential backoff with full jitter in [1 s, min(60 s, 2^(attempt+1) s)]. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (attempt + 1));
  return Math.round(BACKOFF_MIN_MS + random() * (cap - BACKOFF_MIN_MS));
}

/**
 * One POST to `/v1/capture`. 202 → done (accepted and per-index rejected events both leave the
 * outbox; rejected reasons are logged in dev). Other 4xx (400 malformed, 401 wrong key, 413) → drop
 * the batch; never a `client_error` (a wrong key would loop). 429 / 5xx / network → retry.
 */
export async function sendBatch(
  cfg: TransportConfig,
  events: readonly WireEvent[],
): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await cfg.fetch(`${cfg.baseUrl}/v1/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MM-Write-Key': cfg.writeKey,
        'User-Agent': cfg.userAgent,
      },
      body: JSON.stringify(buildEnvelope(cfg, events)),
    });
  } catch {
    return { kind: 'retry', status: 'network' };
  }
  if (res.status === 202 || res.status === 200) {
    let accepted = events.length;
    let rejected: { index: number; reason: string }[] = [];
    try {
      const body = (await res.json()) as { accepted?: number; rejected?: typeof rejected };
      accepted = body.accepted ?? accepted;
      rejected = body.rejected ?? [];
    } catch {
      // body is informational only
    }
    if (rejected.length) cfg.log?.('capture rejected events', rejected);
    return { kind: 'done', accepted, rejected: rejected.length };
  }
  if (res.status === 429 || res.status >= 500) return { kind: 'retry', status: res.status };
  cfg.log?.(`capture dropped a batch (HTTP ${res.status})`);
  return { kind: 'drop', status: res.status };
}
