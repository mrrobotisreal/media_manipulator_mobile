import type {
  AssistantFailReasonProp,
  AssistantLatencyBucket,
  AssistantLinkTargetProp,
  AssistantOutcomeProp,
  AssistantTurnIndexBucket,
} from '@/analytics/events';

/** Position of a user message in its conversation (1-based). */
export function turnIndexBucket(n: number): AssistantTurnIndexBucket {
  if (n <= 1) return '1';
  if (n <= 3) return '2-3';
  if (n <= 10) return '4-10';
  return '11+';
}

/** Send to done. */
export function latencyBucket(ms: number): AssistantLatencyBucket {
  if (ms < 1000) return '<1s';
  if (ms < 3000) return '1-3s';
  if (ms < 10_000) return '3-10s';
  if (ms < 30_000) return '10-30s';
  return '30s+';
}

/** An in-stream `error.code`, a pre-stream refusal or a client failure to the catalog `reason`. */
export function failReason(code: string): AssistantFailReasonProp {
  switch (code) {
    case 'upstream':
    case 'tool_limit':
    case 'network':
      return 'upstream';
    case 'assistant_paused':
      return 'paused';
    case 'rate_limited':
      return 'rate_limited';
    case 'sign_in_required':
      return 'sign_in';
    case 'aborted':
      return 'aborted';
    case 'timeout':
      return 'timeout';
    default:
      return 'error';
  }
}

/** What a finished answer was, from the done event and what streamed before it. */
export function answerOutcome(
  done: { outcome?: 'static' | 'out_of_scope' },
  seen: { action: boolean; ask: boolean },
): AssistantOutcomeProp {
  if (done.outcome) return done.outcome;
  if (seen.ask) return 'ask';
  if (seen.action) return 'action';
  return 'text';
}

export type { AssistantLinkTargetProp };
