import { fetch as expoFetch } from 'expo/fetch';
import { buildHeaders } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import { getAppState } from '@/api/stateRef';
import type { AssistantChatBody, AssistantStreamEvent } from '@/api/schemas/assistant';
import { streamChat, type ChatFetch } from './chatStream';

/** The real transport: `expo/fetch` streaming with the app's identity headers. */
export function streamMediChat(
  body: AssistantChatBody,
  onEvent: (ev: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamChat(
    {
      streamFetch: expoFetch as unknown as ChatFetch,
      buildHeaders,
      baseUrl: API_BASE_URL,
      analyticsOptedOut: () => getAppState()?.settings.analyticsOptOut === true,
    },
    body,
    onEvent,
    signal,
  );
}
