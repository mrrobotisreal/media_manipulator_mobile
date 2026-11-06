import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import type { AssistantChatBody, AssistantStreamEvent } from '@/api/schemas/assistant';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { track } from '@/analytics/track';
import { closeMedi, openMedi, resetMediUiForTests } from '../mediUi';
import { MEDI_SHEET_TOP_GAP, MediSheet, mediKeyboardOffset } from '../ui/MediSheet';
import type { StreamFn } from '../useMediChat';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/analytics/track', () => ({ track: jest.fn(), setContext: jest.fn() }));
const mockOpenWeb = jest.fn();
jest.mock('@/account/openWeb', () => ({ openWebPage: (u: string) => mockOpenWeb(u) }));

const mockList = jest.fn();
const mockFetchOne = jest.fn();
const mockDelete = jest.fn();
const mockFeedback = jest.fn();
jest.mock('@/api/endpoints/assistant', () => ({
  ...jest.requireActual('@/api/endpoints/assistant'),
  useListGuideConversationsQuery: () => mockList(),
  useLazyGetAssistantConversationQuery: () => [mockFetchOne],
  useDeleteAssistantConversationMutation: () => [mockDelete],
  useSendAssistantFeedbackMutation: () => [mockFeedback],
}));

const META: AssistantStreamEvent = {
  type: 'meta',
  conversationId: '11111111-1111-4111-8111-111111111111',
  turnId: '22222222-2222-4222-8222-222222222222',
  model: 'm',
};

/** A scripted stream: emits `events`, then resolves. */
const scripted =
  (events: AssistantStreamEvent[], bodies: AssistantChatBody[] = []): StreamFn =>
  async (body, onEvent) => {
    bodies.push(body);
    for (const e of events) onEvent(e);
  };

const calls = () => (track as jest.Mock).mock.calls as [string, Record<string, unknown>][];
const names = () => calls().map((c) => c[0]);

async function mount(stream: StreamFn) {
  const { store } = await makeReadyStore();
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MediSheet stream={stream} />
      </I18nextProvider>
    </Provider>,
  );
}

async function ask(text: string) {
  await fireEvent.changeText(screen.getByTestId('medi-input'), text);
  await fireEvent.press(screen.getByTestId('medi-send'));
}

beforeEach(() => {
  mockPush.mockClear();
  mockOpenWeb.mockClear();
  mockFeedback.mockClear();
  mockDelete.mockClear();
  mockFetchOne.mockReset();
  mockList.mockReset();
  mockList.mockReturnValue({ isLoading: false, isError: false, data: [], refetch: jest.fn() });
  (track as jest.Mock).mockClear();
  resetMediUiForTests();
});

describe('MediSheet (MA54 S2)', () => {
  it('offsets the composer by everything above the full-height sheet so the keyboard never covers it', () => {
    // S25 (2026-11-06): with no offset the keyboard covered the input and Send.
    expect(MEDI_SHEET_TOP_GAP).toBe(24);
    expect(mediKeyboardOffset(0)).toBe(24);
    expect(mediKeyboardOffset(37)).toBe(61);
  });

  it('renders the welcome copy and the starter chips; a chip sends its text as the message', async () => {
    const bodies: AssistantChatBody[] = [];
    await mount(scripted([META, { type: 'delta', text: 'ok' }, { type: 'done' }], bodies));
    await act(async () => openMedi('button'));
    expect(screen.getByText(/Ask me which tool to use/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('medi-starter-gif'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      surface: 'guide',
      locale: 'en-US',
      message: { text: 'Make a GIF from a video' },
    });
    expect(bodies[0]!.conversationId).toBeUndefined();
  });

  it('streams the answer, sends the conversation id on the next turn, and tracks the funnel', async () => {
    const bodies: AssistantChatBody[] = [];
    await mount(
      scripted(
        [
          META,
          { type: 'tool', name: 'search_help', status: 'running' },
          { type: 'tool', name: 'search_help', status: 'ok' },
          { type: 'delta', text: 'Use **Video to GIF**.' },
          { type: 'done', messageId: '33333333-3333-4333-8333-333333333333' },
        ],
        bodies,
      ),
    );
    await act(async () => openMedi('button'));
    await ask('gif?');
    await waitFor(() => expect(screen.getByTestId('medi-feedback')).toBeTruthy());
    expect(screen.getByText('Video to GIF')).toBeTruthy();
    await ask('and for whatsapp?');
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.conversationId).toBe(META.type === 'meta' ? META.conversationId : '');
    expect(names()).toEqual([
      'assistant_opened',
      'assistant_message_sent',
      'assistant_response_completed',
      'assistant_message_sent',
      'assistant_response_completed',
    ]);
    expect(calls()[0]![1]).toEqual({ surface: 'guide', entry: 'button' });
    expect(calls()[1]![1]).toMatchObject({
      surface: 'guide',
      turn_index_bucket: '1',
      plan: false,
      has_frame: false,
    });
    expect(calls()[2]![1]).toMatchObject({ model_tier: 'guide', tool_rounds: 1, outcome: 'text' });
    expect(calls()[3]![1]).toMatchObject({ turn_index_bucket: '2-3' });
  });

  it('an open_tool action with a preset opens the tool screen with that preset and closes the sheet', async () => {
    await mount(
      scripted([
        META,
        { type: 'delta', text: 'Here.' },
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
        { type: 'done' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('gif');
    await fireEvent.press(await screen.findByTestId('medi-action-c1'));
    expect(mockPush).toHaveBeenCalledWith(
      '/(app)/tool/video/video-to-gif?from=medi&preset=mp4-to-gif',
    );
    expect(mockOpenWeb).not.toHaveBeenCalled();
    expect(calls().find((c) => c[0] === 'assistant_action_clicked')![1]).toEqual({
      surface: 'guide',
      kind: 'open_tool',
    });
    expect(screen.queryByTestId('medi-input')).toBeNull(); // sheet closed
  });

  it('an unknown tool slug becomes "Open on the web" and opens the in-app browser, sheet stays', async () => {
    await mount(
      scripted([
        META,
        {
          type: 'action',
          callId: 'c2',
          kind: 'open_tool',
          label: 'Open Voice Cloning',
          params: { slug: 'voice-cloning', route: '/tools/voice-cloning' },
        },
        { type: 'done' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('clone my voice');
    const btn = await screen.findByTestId('medi-action-c2');
    expect(screen.getByText('Open on the web')).toBeTruthy();
    await fireEvent.press(btn);
    expect(mockOpenWeb).toHaveBeenCalledWith(
      'https://www.media-manipulator.com/tools/voice-cloning',
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('medi-input')).toBeTruthy();
  });

  it('a navigate action to an account page opens the matching Account screen', async () => {
    await mount(
      scripted([
        META,
        {
          type: 'action',
          callId: 'c3',
          kind: 'navigate',
          label: 'Privacy settings',
          params: { target: '/account?tab=privacy' },
        },
        { type: 'done' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('how do I turn off analytics');
    await fireEvent.press(await screen.findByTestId('medi-action-c3'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/(tabs)/account/privacy');
    expect(calls().find((c) => c[0] === 'assistant_action_clicked')![1]).toEqual({
      surface: 'guide',
      kind: 'navigate',
    });
  });

  it('an action with an off-site target renders no button', async () => {
    await mount(
      scripted([
        META,
        {
          type: 'action',
          callId: 'c4',
          kind: 'navigate',
          label: 'Evil',
          params: { target: 'https://evil.example/' },
        },
        { type: 'done' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('x');
    await waitFor(() => expect(screen.queryByTestId('medi-activity')).toBeNull());
    expect(screen.queryByTestId('medi-action-c4')).toBeNull();
  });

  it('ask chips send the choice as the next message', async () => {
    const bodies: AssistantChatBody[] = [];
    await mount(
      scripted(
        [
          META,
          { type: 'ask', callId: 'a1', question: 'Which app?', choices: ['WhatsApp', 'Discord'] },
          { type: 'done' },
        ],
        bodies,
      ),
    );
    await act(async () => openMedi('button'));
    await ask('make a gif');
    await fireEvent.press(await screen.findByText('Discord'));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.message.text).toBe('Discord');
  });

  it('link sanitising: same-site links are tappable and open in place; off-site links are plain text', async () => {
    await mount(
      scripted([
        META,
        {
          type: 'delta',
          text: 'See [Privacy](/account?tab=privacy), [Pricing](https://www.media-manipulator.com/ru/pricing) and [bad](https://evil.example/x) or [js](javascript:alert(1)).',
        },
        { type: 'done' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('links');
    await screen.findByText('Privacy');
    expect(screen.getByText(/bad/)).toBeTruthy(); // shown as plain text, not a link
    expect(screen.getAllByRole('link').map((l) => l.props.children)).toHaveLength(2);
    await fireEvent.press(screen.getByText('Privacy'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/(tabs)/account/privacy');
    await act(async () => openMedi('button'));
    await fireEvent.press(screen.getByText('Pricing'));
    expect(mockOpenWeb).toHaveBeenCalledWith('https://www.media-manipulator.com/pricing');
    const kinds = calls()
      .filter((c) => c[0] === 'assistant_link_clicked')
      .map((c) => c[1]);
    expect(kinds).toEqual([
      { surface: 'guide', target_kind: 'page' },
      { surface: 'guide', target_kind: 'pricing' },
    ]);
  });

  it('static fallback (spend cap): the resting line plus the help-page links, outcome static', async () => {
    await mount(
      scripted([
        META,
        { type: 'delta', text: "I'm taking a short break today. [Pricing](/pricing)" },
        { type: 'done', outcome: 'static' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('what does premium cost');
    await screen.findByText('Pricing');
    expect(calls().find((c) => c[0] === 'assistant_response_completed')![1]).toMatchObject({
      outcome: 'static',
    });
  });

  it('static fallback with no text shows the resting copy', async () => {
    await mount(scripted([META, { type: 'done', outcome: 'static' }]));
    await act(async () => openMedi('button'));
    await ask('hi');
    expect(await screen.findByText(/I'm resting for today/)).toBeTruthy();
  });

  it.each([
    ['limit' as const, 'rate_limited', /a lot of questions/, 'rate_limited'],
    ['paused' as const, 'assistant_paused', /reached today's limit/, 'paused'],
    ['sign-in' as const, 'sign_in_required', /Sign in again/, 'sign_in'],
    ['upstream' as const, 'upstream', /couldn't answer just now/, 'upstream'],
    ['gone' as const, 'not_found', /isn't available right now/, 'error'],
  ])('%s refusal shows its copy and tracks reason %s', async (_n, code, copy, reason) => {
    await mount(scripted([{ type: 'error', code, message: 'x' }]));
    await act(async () => openMedi('button'));
    await ask('hi');
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(calls().find((c) => c[0] === 'assistant_response_failed')![1]).toEqual({
      surface: 'guide',
      reason,
    });
  });

  it('a network failure shows the offline copy and tracks upstream', async () => {
    await mount(async () => {
      throw new Error('Network request failed');
    });
    await act(async () => openMedi('button'));
    await ask('hi');
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    expect(calls().find((c) => c[0] === 'assistant_response_failed')![1]).toEqual({
      surface: 'guide',
      reason: 'upstream',
    });
  });

  it('a stream that ends without done is an upstream failure', async () => {
    await mount(scripted([META, { type: 'delta', text: 'half' }]));
    await act(async () => openMedi('button'));
    await ask('hi');
    expect(await screen.findByText(/couldn't answer just now/)).toBeTruthy();
  });

  it('Stop aborts the request: stopped copy, aborted reason, composer back to Send', async () => {
    let signal!: AbortSignal;
    const stream: StreamFn = (_b, onEvent, s) => {
      signal = s!;
      onEvent(META);
      onEvent({ type: 'delta', text: 'partial' });
      return new Promise((_res, rej) => {
        s!.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    };
    await mount(stream);
    await act(async () => openMedi('button'));
    await ask('long answer');
    await fireEvent.press(await screen.findByTestId('medi-stop'));
    await waitFor(() => expect(screen.getByTestId('medi-send')).toBeTruthy());
    expect(signal.aborted).toBe(true);
    expect(screen.getByText('Stopped.')).toBeTruthy();
    expect(screen.getByText('partial')).toBeTruthy();
    expect(calls().find((c) => c[0] === 'assistant_response_failed')![1]).toEqual({
      surface: 'guide',
      reason: 'aborted',
    });
  });

  it('closing the sheet aborts the request in flight', async () => {
    let signal!: AbortSignal;
    const stream: StreamFn = (_b, _e, s) => {
      signal = s!;
      return new Promise((_res, rej) => {
        s!.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    };
    await mount(stream);
    await act(async () => openMedi('button'));
    await ask('hello');
    await waitFor(() => expect(signal).toBeDefined());
    await act(async () => closeMedi());
    expect(signal.aborted).toBe(true);
  });

  it('unmounting aborts the request in flight', async () => {
    let signal!: AbortSignal;
    const stream: StreamFn = (_b, _e, s) => {
      signal = s!;
      return new Promise(() => undefined);
    };
    const { store } = await makeReadyStore();
    const view = await render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MediSheet stream={stream} />
        </I18nextProvider>
      </Provider>,
    );
    await act(async () => openMedi('button'));
    await ask('hello');
    await waitFor(() => expect(signal).toBeDefined());
    await act(async () => view.unmount());
    expect(signal.aborted).toBe(true);
  });

  it('the composer limits a message to 4,000 characters and ignores blank sends', async () => {
    await mount(scripted([META, { type: 'done' }]));
    await act(async () => openMedi('button'));
    expect(screen.getByTestId('medi-input').props.maxLength).toBe(4000);
    expect(screen.getByTestId('medi-send').props.accessibilityState.disabled).toBe(true);
  });

  it('empty-search entry prefills the composer and tracks entry empty_search', async () => {
    await mount(scripted([META, { type: 'done' }]));
    await act(async () => openMedi('empty_search', 'zzz qqq'));
    expect(screen.getByTestId('medi-input').props.value).toBe('zzz qqq');
    expect(calls()[0]).toEqual(['assistant_opened', { surface: 'guide', entry: 'empty_search' }]);
  });

  it('New chat clears the messages and forgets the conversation id', async () => {
    const bodies: AssistantChatBody[] = [];
    await mount(scripted([META, { type: 'delta', text: 'one' }, { type: 'done' }], bodies));
    await act(async () => openMedi('button'));
    await ask('first');
    await screen.findByText('one');
    await fireEvent.press(screen.getByTestId('medi-new-chat'));
    expect(screen.queryByText('one')).toBeNull();
    await ask('second');
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.conversationId).toBeUndefined();
  });

  it('thumbs: one rating per answer, posts feedback and tracks it', async () => {
    await mount(
      scripted([
        META,
        { type: 'delta', text: 'a' },
        { type: 'done', messageId: '33333333-3333-4333-8333-333333333333' },
      ]),
    );
    await act(async () => openMedi('button'));
    await ask('q');
    await fireEvent.press(await screen.findByTestId('medi-up'));
    expect(mockFeedback).toHaveBeenCalledWith({
      messageId: '33333333-3333-4333-8333-333333333333',
      rating: 'up',
    });
    expect(screen.getByText('Thanks for the feedback.')).toBeTruthy();
    expect(screen.queryByTestId('medi-down')).toBeNull();
    expect(calls().find((c) => c[0] === 'assistant_feedback_given')![1]).toEqual({
      surface: 'guide',
      rating: 'up',
    });
  });

  it('no thumbs for a guest answer (no stored message id)', async () => {
    await mount(scripted([META, { type: 'delta', text: 'a' }, { type: 'done' }]));
    await act(async () => openMedi('button'));
    await ask('q');
    await screen.findByText('a');
    expect(screen.queryByTestId('medi-feedback')).toBeNull();
  });
});

describe('MediSheet history (MA54 decision 5)', () => {
  const convs = [
    { id: 'c-1', surface: 'guide', title: 'GIF for WhatsApp', createdAt: 't', updatedAt: 't' },
    { id: 'c-2', surface: 'guide', title: null, createdAt: 't', updatedAt: 't' },
  ];

  it('lists the conversations (untitled fallback), opens one and continues it', async () => {
    mockList.mockReturnValue({ isLoading: false, isError: false, data: convs, refetch: jest.fn() });
    mockFetchOne.mockResolvedValue({
      data: {
        conversation: convs[0],
        messages: [
          {
            id: 'm1',
            seq: 1,
            turnId: 't',
            role: 'user',
            status: 'complete',
            content: { text: 'gif?' },
            createdAt: 't',
          },
          {
            id: 'm2',
            seq: 2,
            turnId: 't',
            role: 'tool',
            status: 'complete',
            content: {},
            createdAt: 't',
          },
          {
            id: 'm3',
            seq: 3,
            turnId: 't',
            role: 'assistant',
            status: 'complete',
            content: { text: 'Use Video to GIF' },
            createdAt: 't',
          },
        ],
      },
    });
    const bodies: AssistantChatBody[] = [];
    await mount(scripted([META, { type: 'done' }], bodies));
    await act(async () => openMedi('button'));
    await fireEvent.press(screen.getByText('History'));
    expect(screen.getByText('GIF for WhatsApp')).toBeTruthy();
    expect(screen.getByText('Untitled chat')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('medi-conv-c-1'));
    expect(mockFetchOne).toHaveBeenCalledWith('c-1');
    expect(await screen.findByText('Use Video to GIF')).toBeTruthy();
    expect(screen.getByText('gif?')).toBeTruthy();
    await ask('and now for discord');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.conversationId).toBe('c-1');
  });

  it('shows the last 20 only, an empty state and a load error', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...convs[0]!,
      id: `c-${i}`,
      title: `T${i}`,
    }));
    mockList.mockReturnValue({
      isLoading: false,
      isError: false,
      data: many.slice(0, 20),
      refetch: jest.fn(),
    });
    await mount(scripted([META, { type: 'done' }]));
    await act(async () => openMedi('button'));
    await fireEvent.press(screen.getByText('History'));
    expect(screen.getAllByTestId(/^medi-conv-/)).toHaveLength(20);

    mockList.mockReturnValue({ isLoading: false, isError: false, data: [], refetch: jest.fn() });
    await act(async () => closeMedi());
    await act(async () => openMedi('button'));
    await fireEvent.press(screen.getByText('History'));
    expect(screen.getByTestId('medi-history-empty')).toBeTruthy();

    mockList.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: jest.fn(),
    });
    await act(async () => closeMedi());
    await act(async () => openMedi('button'));
    await fireEvent.press(screen.getByText('History'));
    expect(screen.getByTestId('medi-history-error')).toBeTruthy();
  });

  it('deletes a conversation', async () => {
    mockList.mockReturnValue({ isLoading: false, isError: false, data: convs, refetch: jest.fn() });
    await mount(scripted([META, { type: 'done' }]));
    await act(async () => openMedi('button'));
    await fireEvent.press(screen.getByText('History'));
    await fireEvent.press(screen.getByTestId('medi-del-c-1'));
    expect(mockDelete).toHaveBeenCalledWith('c-1');
  });
});
