import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import ToolRoute from '../app/(app)/tool/[family]/[toolId]';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { getContext, track as realTrack } from '@/analytics/track';

let mockParams: Record<string, string> = {};
let mockCaps: unknown;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  router: { push: jest.fn() },
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/analytics/track', () => {
  const actual = jest.requireActual('@/analytics/track');
  return { ...actual, track: jest.fn() };
});
jest.mock('@/voices/useVoicesCapabilities', () => ({
  useVoicesCapabilities: () => ({
    caps: mockCaps,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/voices/useRecorder', () => ({
  useRecorder: () => ({
    state: {
      phase: 'idle',
      elapsedMs: 0,
      level: 0,
      uri: null,
      durationSec: 0,
      verdict: null,
      interrupted: false,
      autoStopped: false,
    },
    start: jest.fn(),
    stop: jest.fn(),
    discard: jest.fn(),
  }),
}));
jest.mock('@/api/endpoints/voices', () => ({
  useListVoicesQuery: () => ({ data: { voices: [], limit: 1, used: 0 } }),
  usePreviewDesignMutation: () => [jest.fn(), { isLoading: false }],
  useDesignVoiceMutation: () => [jest.fn(), { isLoading: false }],
  createVoice: jest.fn(),
  realCreateVoiceDeps: () => ({}),
}));

const caps = (over: Record<string, unknown> = {}, limits: Record<string, unknown> = {}) => ({
  enabled: true,
  warm: true,
  languages: ['en', 'ru'],
  designLanguages: ['en', 'ru'],
  presets: [],
  shiftPresets: [],
  signedIn: true,
  tier: 'free',
  limits: {
    voicesSaved: 1,
    voicesMaxSeconds: 60,
    voicesConvert: true,
    voicesConvertMaxSeconds: 60,
    textMaxChars: 1080,
    ...limits,
  },
  ...over,
});

async function open(params: Record<string, string>) {
  mockParams = params;
  const { store } = await makeReadyStore();
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ToolRoute />
      </I18nextProvider>
    </Provider>,
  );
}

describe('Voices tool screens (MA34)', () => {
  beforeEach(() => (realTrack as jest.Mock).mockClear());

  it('the shifter screen shows the recorder, presets, pitch and formant, plus the file area and a Shift button', async () => {
    mockCaps = caps({ enabled: false });
    await open({ family: 'voices', toolId: 'voice-shift' });
    // The title and the Run button are both "Shift voice".
    expect(screen.getAllByText('Shift voice')).toHaveLength(2);
    expect(screen.getByTestId('recorder-panel')).toBeTruthy();
    expect(screen.getByText('Deeper')).toBeTruthy();
    expect(screen.getByTestId('shift-semitones')).toBeTruthy();
    expect(screen.getByTestId('pick-files')).toBeTruthy();
    expect(screen.queryByTestId('voice-unavailable')).toBeNull();
    expect(realTrack).toHaveBeenCalledWith('tool_viewed', { entry_point: 'deep_link' });
    expect(getContext()).toMatchObject({ tool_slug: 'voice-changer', media_kind: 'audio' });
  });

  it('the cloning screen shows the recorder and a disabled Create; no Start button, no accepts line needed', async () => {
    mockCaps = caps();
    await open({ family: 'voices', toolId: 'voice-clone' });
    expect(screen.getByTestId('recorder-panel')).toBeTruthy();
    expect(screen.getByTestId('clone-create').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId('tool-start')).toBeNull();
    expect(getContext()).toMatchObject({ tool_slug: 'voice-cloning' });
  });

  it('a deep link to the designer with the cap at zero (anonymous) shows the unavailable card, not the controls', async () => {
    mockCaps = caps({}, { voicesSaved: 0 });
    await open({ family: 'voices', toolId: 'voice-design' });
    expect(screen.getByTestId('voice-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('design-preview')).toBeNull();
    expect(screen.queryByTestId('pick-files')).toBeNull();
  });

  it('the designer takes no file: description, chips, preview; no file area', async () => {
    mockCaps = caps();
    await open({ family: 'voices', toolId: 'voice-design' });
    expect(screen.getByTestId('design-description')).toBeTruthy();
    expect(screen.getByTestId('design-preview')).toBeTruthy();
    expect(screen.queryByTestId('pick-media')).toBeNull();
    expect(screen.queryByTestId('pick-files')).toBeNull();
  });

  it('the converter screen needs a target voice: Start is disabled until a recording and a voice are chosen', async () => {
    mockCaps = caps({
      presets: [
        {
          id: 'Vivian',
          name: 'Vivian',
          description: '',
          language: '',
          engine: 'q',
          kind: 'k',
          languages: ['en', 'ru'],
        },
      ],
    });
    await open({ family: 'voices', toolId: 'voice-change' });
    expect(screen.getByTestId('voice-picker')).toBeTruthy();
    expect(screen.getByTestId('tool-start').props.accessibilityState.disabled).toBe(true);
  });
});
