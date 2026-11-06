import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import type {
  AssistantActionEvent,
  AssistantAskEvent,
  AssistantChatBody,
  AssistantConversationDetail,
  AssistantStreamEvent,
} from '@/api/schemas/assistant';
import { answerOutcome, failReason, latencyBucket, turnIndexBucket } from './analytics';
import { isAbortError } from './chatStream';
import { streamMediChat } from './runtime';

export interface MediMessage {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  actions: AssistantActionEvent[];
  ask: AssistantAskEvent | null;
  /** The stored assistant message id (signed-in only): the feedback target. */
  messageId: string | null;
  /** static = the spend-cap answer; out_of_scope = the guide's scope gate. */
  outcome: 'static' | 'out_of_scope' | null;
  status: 'streaming' | 'complete' | 'error' | 'stopped';
  /** The refusal / error code when status is `error` (`upstream`, `limit`, `assistant_paused`, ...). */
  errorCode: string | null;
  /** The server tool currently running ("search_help"), for the activity line. */
  tool: string | null;
}

export type StreamFn = (
  body: AssistantChatBody,
  onEvent: (ev: AssistantStreamEvent) => void,
  signal?: AbortSignal,
) => Promise<void>;

export interface UseMediChatOptions {
  locale: string;
  /** Test seams. */
  stream?: StreamFn;
  now?: () => number;
}

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

function blank(role: MediMessage['role']): MediMessage {
  return {
    key: nextKey(),
    role,
    text: '',
    actions: [],
    ask: null,
    messageId: null,
    outcome: null,
    status: role === 'user' ? 'complete' : 'streaming',
    errorCode: null,
    tool: null,
  };
}

/** A stored conversation as visible messages (tool rows and empty user rows are not shown). */
export function messagesFromDetail(detail: AssistantConversationDetail): MediMessage[] {
  const out: MediMessage[] = [];
  for (const m of detail.messages) {
    if (m.role === 'tool') continue;
    const text = m.content.text ?? '';
    if (!text && m.role === 'user') continue;
    out.push({
      ...blank(m.role),
      text,
      messageId: m.role === 'assistant' ? m.id : null,
      status: m.status === 'error' ? 'error' : 'complete',
      errorCode: m.status === 'error' ? 'upstream' : null,
    });
  }
  return out;
}

/**
 * Medi's conversation state on the phone: visible messages, the conversation id (the API stores
 * conversations for signed-in users and returns it in `meta`), streaming state, Stop, New chat and
 * the analytics of one request. The request is aborted on unmount and on `reset` / `load`; it never
 * polls (ticket decision 3).
 */
export function useMediChat(opts: UseMediChatOptions) {
  const { locale } = opts;
  const stream = opts.stream ?? streamMediChat;
  const now = opts.now ?? Date.now;
  const [messages, setMessages] = useState<MediMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const convRef = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  const patchLast = useCallback((fn: (m: MediMessage) => MediMessage) => {
    if (!alive.current) return;
    setMessages((list) => {
      const last = list[list.length - 1];
      if (!last || last.role !== 'assistant') return list;
      return [...list.slice(0, -1), fn(last)];
    });
  }, []);

  const send = useCallback(
    (text: string): boolean => {
      const clean = text.trim();
      if (!clean || controller.current) return false;
      const userTurns = messages.filter((m) => m.role === 'user').length + 1;
      setMessages((list) => [...list, { ...blank('user'), text: clean }, blank('assistant')]);
      const body: AssistantChatBody = {
        surface: 'guide',
        locale,
        // The phone has no URL; the page is the tab the guide sits on (the system prompt reads it).
        page: { path: '/tools', title: 'Media Manipulator app' },
        message: { text: clean },
        ...(convRef.current ? { conversationId: convRef.current } : {}),
      };
      const ac = new AbortController();
      controller.current = ac;
      setStreaming(true);
      track(EVENTS.ASSISTANT_MESSAGE_SENT, {
        surface: 'guide',
        has_frame: false,
        turn_index_bucket: turnIndexBucket(userTurns),
        plan: false,
      });
      const started = now();
      const seen = { action: false, ask: false };
      let rounds = 0;
      let finished = false;

      const onEvent = (ev: AssistantStreamEvent) => {
        switch (ev.type) {
          case 'meta':
            if (ev.conversationId) convRef.current = ev.conversationId;
            break;
          case 'delta':
            patchLast((m) => ({ ...m, text: m.text + ev.text, tool: null }));
            break;
          case 'tool':
            if (ev.status === 'running') rounds++;
            patchLast((m) => ({ ...m, tool: ev.status === 'running' ? ev.name : null }));
            break;
          case 'action':
            seen.action = true;
            patchLast((m) => ({ ...m, actions: [...m.actions, ev] }));
            break;
          case 'ask':
            seen.ask = true;
            patchLast((m) => ({ ...m, ask: ev }));
            break;
          case 'done':
            finished = true;
            patchLast((m) => ({
              ...m,
              status: 'complete',
              tool: null,
              messageId: ev.messageId ?? null,
              outcome: ev.outcome ?? null,
            }));
            track(EVENTS.ASSISTANT_RESPONSE_COMPLETED, {
              surface: 'guide',
              model_tier: 'guide',
              latency_bucket: latencyBucket(now() - started),
              tool_rounds: Math.min(rounds, 4),
              outcome: answerOutcome(ev, seen),
            });
            break;
          case 'error':
            finished = true;
            patchLast((m) => ({ ...m, status: 'error', tool: null, errorCode: ev.code }));
            track(EVENTS.ASSISTANT_RESPONSE_FAILED, {
              surface: 'guide',
              reason: failReason(ev.code),
            });
            break;
          default:
            // usage / limit / edits: nothing to show in the guide.
            break;
        }
      };

      void (async () => {
        try {
          await stream(body, onEvent, ac.signal);
          if (!finished && !ac.signal.aborted) {
            patchLast((m) => ({ ...m, status: 'error', tool: null, errorCode: 'upstream' }));
            track(EVENTS.ASSISTANT_RESPONSE_FAILED, { surface: 'guide', reason: 'upstream' });
          }
        } catch (err) {
          const aborted = isAbortError(err) || ac.signal.aborted;
          patchLast((m) => ({
            ...m,
            status: aborted ? 'stopped' : 'error',
            tool: null,
            errorCode: aborted ? null : 'network',
          }));
          track(EVENTS.ASSISTANT_RESPONSE_FAILED, {
            surface: 'guide',
            reason: aborted ? 'aborted' : 'upstream',
          });
        } finally {
          if (controller.current === ac) controller.current = null;
          if (alive.current) setStreaming(false);
        }
      })();
      return true;
    },
    [messages, locale, stream, now, patchLast],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  /** New chat: forget the conversation locally (the stored one stays in History). */
  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setStreaming(false);
    setMessages([]);
    convRef.current = null;
  }, []);

  /** Continue a stored conversation (History). */
  const load = useCallback((detail: AssistantConversationDetail) => {
    controller.current?.abort();
    controller.current = null;
    setStreaming(false);
    setMessages(messagesFromDetail(detail));
    convRef.current = detail.conversation.id;
  }, []);

  return { messages, streaming, send, stop, reset, load };
}
