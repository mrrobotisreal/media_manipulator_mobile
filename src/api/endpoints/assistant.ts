import { mmApi } from '../mmApi';
import {
  assistantCapabilitiesSchema,
  assistantConversationDetailSchema,
  assistantConversationListSchema,
  type AssistantCapabilities,
  type AssistantConversation,
  type AssistantConversationDetail,
} from '../schemas/assistant';

/** The sheet shows the last 20 guide conversations (ticket MA54 decision 5); the API returns up to 50. */
export const HISTORY_LIMIT = 20;

/**
 * Medi's REST routes (handlers/assistant.go): capabilities (always mounted), the signed-in-only
 * conversation list / get / delete, and per-answer feedback. Charging never happens here; the
 * guide is free. A 404 on any but capabilities means Medi is off for this caller.
 */
export const assistantApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    getAssistantCapabilities: build.query<AssistantCapabilities, void>({
      query: () => ({
        url: '/assistant/capabilities',
        schema: assistantCapabilitiesSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 300,
    }),
    listGuideConversations: build.query<AssistantConversation[], void>({
      query: () => ({
        url: '/assistant/conversations',
        params: { surface: 'guide' },
        schema: assistantConversationListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { conversations: AssistantConversation[] }) =>
        r.conversations.slice(0, HISTORY_LIMIT),
      providesTags: ['Assistant'],
    }),
    getAssistantConversation: build.query<AssistantConversationDetail, string>({
      query: (id) => ({
        url: `/assistant/conversations/${encodeURIComponent(id)}`,
        schema: assistantConversationDetailSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 0,
    }),
    deleteAssistantConversation: build.mutation<unknown, string>({
      query: (id) => ({
        url: `/assistant/conversations/${encodeURIComponent(id)}`,
        method: 'DELETE',
        skipAccountInvalidation: true,
      }),
      invalidatesTags: ['Assistant'],
    }),
    sendAssistantFeedback: build.mutation<unknown, { messageId: string; rating: 'up' | 'down' }>({
      query: ({ messageId, rating }) => ({
        url: `/assistant/messages/${encodeURIComponent(messageId)}/feedback`,
        method: 'POST',
        body: { rating },
        skipAccountInvalidation: true,
      }),
    }),
  }),
});

export const {
  useGetAssistantCapabilitiesQuery,
  useListGuideConversationsQuery,
  useDeleteAssistantConversationMutation,
  useSendAssistantFeedbackMutation,
  useLazyGetAssistantConversationQuery,
} = assistantApi;

/** Is the guide answering for this caller? (`enabled` and `guide.enabled`.) */
export function guideEnabled(caps: AssistantCapabilities | undefined | null): boolean {
  return !!caps && caps.enabled && caps.guide.enabled;
}
