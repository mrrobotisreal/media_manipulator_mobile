import type { ClientErrorProps } from './events';
import { sha256Hex } from './sha256';

/** Catalog description: at most 10 distinct errors per session, deduped by `stack_hash`. */
export const MAX_ERRORS_PER_SESSION = 10;
export const MAX_MESSAGE_LEN = 200;
const STACK_FRAMES = 5;

/**
 * Scrubs an error message before it leaves the device (**proposed**): URL query strings, bearer
 * tokens and JWTs are stripped (a presigned URL carries a signature), then emails, UUID-like and
 * long hex ids and digit runs become `<email>`, `<id>`, `<n>`; truncated to 200 chars. The server's
 * sanitizer redacts emails too; this keeps ids and file-ish numbers out of a grouped dimension.
 */
export function scrubMessage(message: string): string {
  let out = message.replace(/(https?:\/\/[^\s?]+)\?\S*/g, '$1?<q>');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <token>');
  out = out.replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>');
  out = out.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{16,}\b/gi, '<id>');
  out = out.replace(/\d+/g, '<n>');
  return out.length > MAX_MESSAGE_LEN ? out.slice(0, MAX_MESSAGE_LEN) : out;
}

/** The first 5 frame lines of a JS stack (Hermes `at fn (file:line:col)` or `fn@file:line:col`). */
export function topFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s|@/.test(l))
    .slice(0, STACK_FRAMES);
}

/** SHA-256 of the scrubbed message + the first 5 frames, hex, 16 chars. */
export function stackHash(scrubbed: string, frames: readonly string[]): string {
  return sha256Hex([scrubbed, ...frames].join('\n')).slice(0, 16);
}

export function describeError(value: unknown): { message: string; type: string; stack?: string } {
  if (value instanceof Error) {
    return {
      message: value.message || value.name || 'Error',
      type: value.name || 'Error',
      stack: value.stack,
    };
  }
  if (typeof value === 'string') return { message: value, type: 'string' };
  try {
    return { message: JSON.stringify(value) ?? 'unknown', type: typeof value };
  } catch {
    return { message: 'unserializable error', type: typeof value };
  }
}

/** `client_error` props for a thrown value. No stack text (Crashlytics has stacks). */
export function errorProps(
  error: unknown,
  source: NonNullable<ClientErrorProps['source']>,
  stage?: string,
): ClientErrorProps {
  const d = describeError(error);
  const message = scrubMessage(d.message);
  return {
    message,
    stack_hash: stackHash(message, topFrames(d.stack)),
    source,
    ...(stage ? { stage } : {}),
    error_type: d.type.slice(0, 64),
  };
}

/**
 * Per-session gate every `client_error` passes through (also the manual `track(EVENTS.CLIENT_ERROR)`
 * call sites): scrubs the message, fills `stack_hash` when absent, drops repeats and caps at 10.
 */
export function createErrorGate(max: number = MAX_ERRORS_PER_SESSION) {
  let session: string | null = null;
  const seen = new Set<string>();
  return {
    admit(props: ClientErrorProps, sessionId: string): ClientErrorProps | null {
      if (sessionId !== session) {
        session = sessionId;
        seen.clear();
      }
      const message = scrubMessage(props.message ?? '');
      const hash =
        props.stack_hash ?? stackHash(message, [props.stage ?? '', props.error_type ?? '']);
      if (seen.has(hash) || seen.size >= max) return null;
      seen.add(hash);
      return { ...props, message, stack_hash: hash };
    },
  };
}
