import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { i18n } from '@/i18n';
import { FREE_LIMITS } from '@/quota/testFixtures';
import { makeReadyStore } from '@/state/testing';
import { track } from '@/analytics/track';
import {
  audioConvertDefaults,
  audioEffectsDefaults,
  audioWaveformDefaults,
} from '../../../options/audio';
import { AudioConvertForm } from '../AudioConvertForm';
import { AudioEffectsForm } from '../AudioEffectsForm';
import { AudioWaveformForm } from '../AudioWaveformForm';
import { TOOL_BY_ID } from '../../../registry';

jest.mock('@/analytics/track', () => {
  const actual = jest.requireActual('@/analytics/track');
  return { ...actual, track: jest.fn() };
});
let mockLimits: typeof FREE_LIMITS | undefined;
jest.mock('@/quota/useAccountLimitsFull', () => ({ useAccountLimitsFull: () => mockLimits }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({}),
  useAudioPlayerStatus: () => ({ isLoaded: false, duration: 0, currentTime: 0 }),
}));

function Harness<F extends object>({
  Form,
  initial,
}: {
  Form: (p: { value: F; onChange: (n: F) => void }) => React.ReactElement;
  initial: F;
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <Form value={v} onChange={setV} />
    </>
  );
}

async function mount(ui: React.ReactElement, maxOutputHeight?: number) {
  const { store } = await makeReadyStore();
  mockLimits = maxOutputHeight === undefined ? undefined : { ...FREE_LIMITS, maxOutputHeight };
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
}

beforeEach(() => (track as jest.Mock).mockClear());

describe('AudioConvertForm', () => {
  it('hides bitrate for wav/flac/alac and shows it for lossy formats', async () => {
    await mount(<Harness Form={AudioConvertForm} initial={audioConvertDefaults} />);
    expect(screen.getByTestId('bitrate-192')).toBeTruthy();
    for (const f of ['wav', 'flac', 'alac']) {
      await fireEvent.press(screen.getByTestId(`format-${f}`));
      expect(screen.queryByTestId('bitrate-192')).toBeNull();
    }
    await fireEvent.press(screen.getByTestId('format-opus'));
    expect(screen.getByTestId('bitrate-192')).toBeTruthy();
  });
});

describe('AudioEffectsForm', () => {
  it('shows only the chosen effect controls and asks for a chip when none', async () => {
    await mount(<Harness Form={AudioEffectsForm} initial={audioEffectsDefaults} />);
    expect(screen.getByLabelText('Speed')).toBeTruthy();
    expect(screen.queryByLabelText('Pitch')).toBeNull();
    await fireEvent.press(screen.getByTestId('effect-pitch'));
    expect(screen.getByLabelText('Pitch')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('effect-speed'));
    await fireEvent.press(screen.getByTestId('effect-pitch'));
    expect(screen.getByTestId('effects-pick-hint')).toBeTruthy();
    expect(
      TOOL_BY_ID.get('audio-effects')!.blockReason!({ ...audioEffectsDefaults, effects: [] }),
    ).not.toBeNull();
  });
});

describe('AudioWaveformForm', () => {
  it('disables the 1:1 2160 chip for maxOutputHeight 1440 and shows the neutral hint', async () => {
    await mount(<Harness Form={AudioWaveformForm} initial={audioWaveformDefaults} />, 1440);
    await fireEvent.press(screen.getByTestId('more-toggle'));
    expect(screen.getByTestId('size-other-xl-1x1').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('size-other-large-1x1').props.accessibilityState.disabled).toBe(
      false,
    );
    expect(screen.getByTestId('height-limit-hint')).toBeTruthy();
    expect(screen.getByText('Up to 1440p on your plan.')).toBeTruthy();
  });

  it('leaves every chip enabled without a known limit', async () => {
    await mount(<Harness Form={AudioWaveformForm} initial={audioWaveformDefaults} />);
    await fireEvent.press(screen.getByTestId('more-toggle'));
    expect(screen.getByTestId('size-other-xl-1x1').props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId('height-limit-hint')).toBeNull();
  });
});
