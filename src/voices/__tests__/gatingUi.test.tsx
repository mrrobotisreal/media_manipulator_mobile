import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Text } from 'react-native';
import { i18n } from '@/i18n';
import { VoiceGate } from '../ui/VoiceGate';

let mockCaps: unknown;
let mockLoading = false;
jest.mock('../useVoicesCapabilities', () => ({
  useVoicesCapabilities: () => ({
    caps: mockCaps,
    isLoading: mockLoading,
    isError: false,
    refetch: jest.fn(),
  }),
}));

const caps = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  warm: true,
  limits: {
    voicesSaved: 1,
    voicesConvert: true,
    voicesConvertMaxSeconds: 60,
    voicesMaxSeconds: 60,
    textMaxChars: 1080,
  },
  ...over,
});
const gate = (cap: 'voiceClone' | 'voiceShift' | 'voiceChange') =>
  render(
    <I18nextProvider i18n={i18n}>
      <VoiceGate capability={cap}>
        <Text>form</Text>
      </VoiceGate>
    </I18nextProvider>,
  );

describe('VoiceGate (a deep link to a hidden tool)', () => {
  beforeEach(() => {
    mockLoading = false;
  });
  it('with enabled:false the clone form is replaced by the unavailable card that points to the shifter', async () => {
    mockCaps = caps({ enabled: false });
    await gate('voiceClone');
    expect(screen.queryByText('form')).toBeNull();
    expect(screen.getByTestId('voice-unavailable')).toBeTruthy();
    expect(screen.getByText(/pitch shifter below does not need the voice engine/i)).toBeTruthy();
  });
  it('the shifter form still renders with enabled:false (no warming note, no unavailable card)', async () => {
    mockCaps = caps({ enabled: false, warm: false });
    await gate('voiceShift');
    expect(screen.getByText('form')).toBeTruthy();
    expect(screen.queryByTestId('voice-warming')).toBeNull();
  });
  it('a cold engine (warm:false) shows the warming-up note above an AI tool', async () => {
    mockCaps = caps({ warm: false });
    await gate('voiceChange');
    expect(screen.getByTestId('voice-warming')).toBeTruthy();
    expect(screen.getByText('form')).toBeTruthy();
  });
  it('no capabilities (call failed) shows the unavailable card', async () => {
    mockCaps = undefined;
    await gate('voiceShift');
    expect(screen.getByTestId('voice-unavailable')).toBeTruthy();
  });
});
