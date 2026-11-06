import { z } from 'zod';

/**
 * Medi (code name `assistant`) contracts, mirrored from media_manipulator_api
 * `internal/assistant/events.go` and `internal/handlers/assistant.go` (camelCase) and from the web's
 * `schemas/assistant.ts`. Every SSE frame and every response is parsed here, so a malformed one is
 * dropped instead of rendered. Answer text is model-written markdown: render it only through
 * `src/assistant/ui/Markdown.tsx`.
 */
export const ASSISTANT_SURFACE = 'guide' as const;

export const assistantActionKindSchema = z.enum([
  'navigate',
  'open_tool',
  'generate_captions',
  'subject_mask',
  'heal',
  'voiceover',
  'derive_audio',
  'export',
  // MM116b: a single-tool job proposal. The phone opens the tool (it does not run the job in chat).
  'confirm_job',
]);
export type AssistantActionKind = z.infer<typeof assistantActionKindSchema>;

/**
 * `meta → (delta | tool)* → [edits | action | ask]* → usage → done`, or `… → error` (any failure
 * after meta). One JSON object per `data:` record; `: ping` comments every 15 s.
 */
export const assistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meta'),
    conversationId: z.string().nullable(),
    turnId: z.string(),
    model: z.string(),
    promptVersion: z.string().optional(),
  }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('tool'), name: z.string(), status: z.string() }),
  z.object({
    type: z.literal('edits'),
    callId: z.string(),
    summary: z.string(),
    reason: z.string().optional(),
    ops: z.unknown(),
  }),
  z.object({
    type: z.literal('action'),
    callId: z.string(),
    kind: assistantActionKindSchema,
    label: z.string(),
    params: z.record(z.string(), z.unknown()).nullish(),
  }),
  z.object({
    type: z.literal('ask'),
    callId: z.string(),
    question: z.string(),
    choices: z.array(z.string()).max(4).nullish(),
  }),
  z.object({
    type: z.literal('usage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedTokens: z.number(),
    costUsd: z.number(),
  }),
  z.object({
    type: z.literal('limit'),
    metric: z.string(),
    limit: z.number(),
    upgradePath: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    awaiting: z.literal('edit_result').optional(),
    messageId: z.string().optional(),
    /** "static" (the spend-cap answer) | "out_of_scope" (the guide's scope gate); absent for a model answer. */
    outcome: z.enum(['static', 'out_of_scope']).optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;
export type AssistantActionEvent = Extract<AssistantStreamEvent, { type: 'action' }>;
export type AssistantAskEvent = Extract<AssistantStreamEvent, { type: 'ask' }>;

/** `GET /api/assistant/capabilities` (always mounted; `{enabled:false}` when Medi is off for the caller). */
export const assistantCapabilitiesSchema = z.union([
  z.object({
    enabled: z.literal(true),
    guide: z.object({ enabled: z.boolean() }),
    copilot: z.object({
      enabled: z.boolean(),
      surfaces: z.array(z.string()),
      signedInOnly: z.boolean(),
      editSurfaces: z.array(z.string()).nullish(),
    }),
    turns: z.object({ limit: z.number(), remaining: z.number(), resetsAt: z.string() }),
    frames: z.boolean(),
    maxFrameBytes: z.number(),
    maxMessageChars: z.number(),
    spendCapReached: z.boolean(),
    promptVersion: z.string().optional(),
  }),
  z.object({ enabled: z.literal(false) }),
]);
export type AssistantCapabilities = z.infer<typeof assistantCapabilitiesSchema>;

export const assistantConversationSchema = z.object({
  id: z.string(),
  surface: z.string(),
  projectKind: z.string().nullish(),
  projectId: z.string().nullish(),
  title: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

export const assistantConversationListSchema = z.object({
  conversations: z.array(assistantConversationSchema),
});

/** A stored message's content jsonb (the fields a client may render). */
export const assistantStoredContentSchema = z
  .object({
    text: z.string().optional(),
    actions: z
      .array(z.object({ callId: z.string(), kind: z.string(), summary: z.string().optional() }))
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const assistantStoredMessageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  turnId: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  status: z.string(),
  content: assistantStoredContentSchema,
  createdAt: z.string(),
});

export const assistantConversationDetailSchema = z.object({
  conversation: assistantConversationSchema,
  messages: z.array(assistantStoredMessageSchema),
});
export type AssistantConversationDetail = z.infer<typeof assistantConversationDetailSchema>;

/** `POST /api/assistant/chat` body for a guide message (copilot-only fields are never sent from the phone). */
export interface AssistantChatBody {
  surface: typeof ASSISTANT_SURFACE;
  conversationId?: string;
  locale: string;
  page: { path: string; title?: string };
  message: { text: string };
}
