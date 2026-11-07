import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { VoiceCloneForm } from '@/tools/forms/voices/VoiceCloneForm';
import { i18n } from '@/i18n';
import type { IntakeFile } from '@/files/types';
import { VOICE_CONSENT_TEXT_VERSION } from '@/tools/voices/consent';

const mockCreate = jest.fn();
let mockList: { data?: { voices: unknown[]; limit: number; used: number } } = {};
jest.mock('@/api/endpoints/voices', () => ({
  createVoice: (...a: unknown[]) => mockCreate(...a),
  realCreateVoiceDeps: () => ({ fake: true }),
  useListVoicesQuery: () => mockList,
}));
jest.mock('@/voices/useVoicesCapabilities', () => ({
  useVoicesCapabilities: () => ({
    caps: {
      enabled: true,
      warm: true,
      languages: ['en', 'ru', 'de'],
      designLanguages: ['en'],
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
      },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/voices/ui/RecorderPanel', () => ({ RecorderPanel: () => null }));
jest.mock('@/voices/ui/SpeakPanel', () => ({ SpeakPanel: () => null }));
jest.mock('@/voices/ui/VoiceCard', () => ({ VoiceSummary: () => null }));
jest.mock('@/voices/nav', () => ({ openMyVoices: jest.fn() }));
jest.mock('@/account/openWeb', () => ({ openWebPage: jest.fn() }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('@/i18n/useActiveLocale', () => ({ useActiveLocale: () => 'ru-RU' }));

const file = (id: string, durationSec = 12): IntakeFile => ({
  id,
  uri: `file:///c/${id}.m4a`,
  name: `${id}.m4a`,
  extension: 'm4a',
  mimeType: 'audio/mp4',
  mediaKind: 'audio',
  sizeBytes: 5000,
  durationSec,
  source: 'recorder',
  copiedAt: 1,
});

function ui(files: IntakeFile[]) {
  return (
    <I18nextProvider i18n={i18n}>
      <VoiceCloneForm value={{}} onChange={jest.fn()} ctx={{ files }} onFiles={jest.fn()} />
    </I18nextProvider>
  );
}
const create = () => screen.getByTestId('clone-create');
const disabled = () => !!create().props.accessibilityState?.disabled;

beforeEach(() => {
  mockCreate.mockReset();
  mockList = { data: { voices: [], limit: 1, used: 0 } };
});

describe('clone consent record (MA34 decision 3)', () => {
  it('shows the exact web consent sentence and the note naming the version', async () => {
    await render(ui([file('a')]));
    expect(
      screen.getByText(
        'This is my voice, or I have the explicit permission of the person whose voice this is.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(new RegExp(`\\(${VOICE_CONSENT_TEXT_VERSION}\\)`))).toBeTruthy();
    expect(screen.getByText(/section 8\.11 of the Terms/i)).toBeTruthy();
  });

  it('Create is disabled until a name is typed AND the consent box is ticked', async () => {
    await render(ui([file('a')]));
    expect(disabled()).toBe(true);
    await fireEvent.changeText(screen.getByTestId('clone-name'), 'Mitch');
    expect(disabled()).toBe(true);
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(disabled()).toBe(false);
  });

  it('Create stays disabled with no recording, even with a name', async () => {
    await render(ui([]));
    await fireEvent.changeText(screen.getByTestId('clone-name'), 'Mitch');
    expect(disabled()).toBe(true);
  });

  it('a take shorter than 5 s keeps Create disabled and says so', async () => {
    await render(ui([file('a', 3)]));
    await fireEvent.changeText(screen.getByTestId('clone-name'), 'Mitch');
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(disabled()).toBe(true);
    expect(screen.getByTestId('clone-too-short')).toBeTruthy();
  });

  it('the consent box resets whenever the recording changes', async () => {
    const view = await render(ui([file('a')]));
    await fireEvent.changeText(screen.getByTestId('clone-name'), 'Mitch');
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(disabled()).toBe(false);
    await view.rerender(ui([file('b')]));
    expect(screen.getByTestId('consent-checkbox').props.accessibilityState.checked).toBe(false);
    expect(disabled()).toBe(true);
    // ...and removing the recording clears it too.
    await view.rerender(ui([]));
    expect(screen.getByTestId('consent-checkbox').props.accessibilityState.checked).toBe(false);
  });

  it('the multipart carries consent=true and consentTextVersion=2026-10-28, once even on a double tap', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockCreate.mockImplementation(() => new Promise((r) => (finish = r)));
    await render(ui([file('a')]));
    await fireEvent.changeText(screen.getByTestId('clone-name'), '  Mitch  ');
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await act(async () => {
      fireEvent.press(create());
      fireEvent.press(create());
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![0]).toEqual({
      file: { uri: 'file:///c/a.m4a', mimeType: 'audio/mp4' },
      name: 'Mitch',
      languageHint: 'ru',
      consent: true,
      consentTextVersion: '2026-10-28',
    });
    expect(screen.getByTestId('clone-creating')).toBeTruthy();
    await act(async () => {
      finish({ ok: false, error: { status: 400, code: 'api:no_speech_detected', details: {} } });
    });
    expect(screen.getByTestId('clone-error')).toHaveTextContent(/could not hear speech/i);
  });

  it('at the plan limit Create is disabled and the neutral message shows used and limit', async () => {
    mockList = { data: { voices: [], limit: 1, used: 1 } };
    await render(ui([file('a')]));
    await fireEvent.changeText(screen.getByTestId('clone-name'), 'Mitch');
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(disabled()).toBe(true);
    expect(screen.getByTestId('clone-at-limit')).toHaveTextContent(
      "You've saved 1 of 1 voices on your plan. Delete one to make room.",
    );
  });

  it('unlimited (-1) never blocks on the limit', async () => {
    mockList = { data: { voices: [], limit: -1, used: 40 } };
    await render(ui([file('a')]));
    await fireEvent.changeText(screen.getByTestId('clone-name'), 'Mitch');
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(disabled()).toBe(false);
  });
});
