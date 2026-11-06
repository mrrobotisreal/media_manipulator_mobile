/**
 * Recorded-shape SSE bodies of POST /api/assistant/chat (internal/assistant/events.go wire format:
 * `data: {json}\n\n`, `: ping` comments). Every event type the API emits appears at least once.
 */
export const META = {
  type: 'meta',
  conversationId: '11111111-1111-4111-8111-111111111111',
  turnId: '22222222-2222-4222-8222-222222222222',
  model: 'anthropic/claude-haiku-5.5',
  promptVersion: 'abc123def456',
} as const;

const rec = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

export const FULL_ANSWER_EVENTS: unknown[] = [
  META,
  { type: 'tool', name: 'search_help', status: 'running' },
  { type: 'tool', name: 'search_help', status: 'ok' },
  { type: 'delta', text: 'Use **Video to GIF**' },
  { type: 'delta', text: ' for that.' },
  {
    type: 'action',
    callId: 'c1',
    kind: 'open_tool',
    label: 'Open Video to GIF',
    params: {
      slug: 'convert-video-to-animated-gif',
      route: '/tools/convert-video-to-animated-gif',
      preset: 'mp4-to-gif',
    },
  },
  { type: 'ask', callId: 'c2', question: 'Which social app?', choices: ['WhatsApp', 'Discord'] },
  { type: 'edits', callId: 'c3', summary: 'x', ops: [] },
  { type: 'limit', metric: 'assistant_turns', limit: 5, upgradePath: 'premium' },
  { type: 'usage', inputTokens: 10, outputTokens: 5, cachedTokens: 0, costUsd: 0.0001 },
  { type: 'done', messageId: '33333333-3333-4333-8333-333333333333' },
];

export const FULL_ANSWER_SSE = `: ping\n\n${FULL_ANSWER_EVENTS.map(rec).join('')}`;

export const STATIC_SSE =
  rec(META) +
  rec({ type: 'delta', text: "I'm taking a short break today. [Pricing](/pricing)" }) +
  rec({ type: 'done', outcome: 'static' });

export const ERROR_SSE =
  rec(META) +
  rec({ type: 'delta', text: 'Part' }) +
  rec({ type: 'error', code: 'upstream', message: 'upstream failed' });

export const MALFORMED_SSE =
  'data: {not json\n\n' +
  rec({ type: 'mystery', x: 1 }) +
  rec({ type: 'action', callId: 'c', kind: 'teleport', label: 'x' }) +
  rec({ type: 'delta', text: 'ok' }) +
  rec({ type: 'done' });
