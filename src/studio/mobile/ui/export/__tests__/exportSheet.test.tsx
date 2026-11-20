/**
 * MA58 decision 2: the Darkroom export sheet renders the API's output table (a recorded
 * `/studio/export-options` answer), disables locked entries per tier with the neutral "Not on your
 * plan" line, reports `studio_export_format_locked`, and builds the export request the web builds.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { track } from '@/analytics/track';
import { studioExportOptionsSchema, type StudioExportOptions } from '@/api/schemas/studio';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import raw from './exportOptions.fixture.json';
import {
  accessOf,
  buildExportRequest,
  choiceLock,
  defaultChoices,
  exportProps,
  presetRows,
  type ExportChoices,
} from '../exportModel';
import { ExportForm } from '../StudioExportSheet';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const free = studioExportOptionsSchema.parse(raw);
const withCaller = (tier: string, formats: string[], advanced: boolean): StudioExportOptions => ({
  ...free,
  caller: { tier, formats, advanced },
});
const PREMIUM = [
  ...free.caller.formats,
  'mov',
  'mkv',
  'webm',
  'opus',
  'vp9',
  'vorbis',
  'subs_embedded',
];
const premium = withCaller('premium', PREMIUM, true);
const pro = withCaller('pro', [...PREMIUM, 'av1', 'prores', 'flac', 'pcm_s24le'], true);

const project = {
  id: 'proj-1',
  name: 'Trip cut',
  durationSeconds: 60,
  width: 1920,
  height: 1080,
  tracks: [],
  captions: [{ id: 'c1', start: 0, end: 1, text: 'hi' }],
  captionStyle: { animation: 'pop' },
} as never;

async function mount(options: StudioExportOptions, onStart = jest.fn(), maxOutputHeight?: number) {
  const { store } = await makeReadyStore();
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ExportForm
          table={options.table}
          access={accessOf(options)}
          project={project}
          maxOutputHeight={maxOutputHeight}
          onStart={onStart}
        />
      </I18nextProvider>
    </Provider>,
  );
  return onStart;
}

const locked = (testID: string) =>
  Boolean(screen.getByTestId(testID).props.accessibilityState?.disabled);

beforeEach(() => (track as jest.Mock).mockClear());

describe('export sheet from the recorded /export-options', () => {
  it('lists every preset of the table with the web labels; locks follow the free tier', async () => {
    await mount(free);
    for (const p of free.table.presets)
      expect(screen.getByTestId(`studio-export-preset-${p.key}`)).toBeTruthy();
    expect(screen.getByText('MP4 · H.264 (plays everywhere)')).toBeTruthy();
    expect(locked('studio-export-preset-mp4_h264')).toBe(false);
    expect(locked('studio-export-preset-mp4_hevc')).toBe(false);
    expect(locked('studio-export-preset-mov_h264')).toBe(true);
    expect(locked('studio-export-preset-webm_vp9_opus')).toBe(true);
    expect(locked('studio-export-preset-mov_prores')).toBe(true);
    // Advanced is Premium+: the toggle is refused with the neutral line.
    expect(screen.getByTestId('studio-export-advanced-locked')).toBeTruthy();
    expect(screen.getAllByText(/Not on your plan/).length).toBeGreaterThan(0);
    // No purchase copy anywhere (MA-0008).
    expect(screen.queryByText(/Upgrade|Premium raises|pricing/i)).toBeNull();
  });

  it('a locked preset press reports studio_export_format_locked and does not select it', async () => {
    await mount(free);
    await fireEvent.press(screen.getByTestId('studio-export-preset-mov_h264'));
    expect(track).toHaveBeenCalledWith(
      'studio_export_format_locked',
      { option: 'mov', required: 'premium', tier: 'free', host: 'mm' },
      expect.objectContaining({ tool_slug: 'darkroom' }),
    );
    expect(
      screen.getByTestId('studio-export-preset-mp4_h264').props.accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it('Premium unlocks MOV/MKV/WebM and Advanced, Pro the Pro-only rows', async () => {
    expect(
      presetRows(premium.table, accessOf(premium))
        .filter((r) => r.lock)
        .map((r) => r.preset.key),
    ).toEqual(['mp4_av1', 'webm_av1_opus', 'mov_prores', 'audio_flac', 'audio_wav24']);
    expect(presetRows(pro.table, accessOf(pro)).every((r) => !r.lock)).toBe(true);
    expect(
      presetRows(free.table, { ...accessOf(free), tier: 'operator' }).every((r) => !r.lock),
    ).toBe(true);
    await mount(premium);
    expect(screen.queryByTestId('studio-export-advanced-locked')).toBeNull();
    expect(locked('studio-export-preset-mov_hevc')).toBe(false);
    expect(locked('studio-export-preset-mov_prores')).toBe(true);
  });

  it('a rung above the plan height is locked, never hidden', async () => {
    await mount(free, jest.fn(), 1440);
    expect(locked('studio-export-resolution-2160')).toBe(true);
    expect(locked('studio-export-resolution-1080')).toBe(false);
  });

  it('Start sends 1080p H.264 as the preset body (the web wire shape)', async () => {
    const onStart = await mount(free);
    await fireEvent.press(screen.getByTestId('studio-export-resolution-1080'));
    await fireEvent.press(screen.getByTestId('studio-export-start'));
    const c = onStart.mock.calls[0]![0] as ExportChoices;
    expect(buildExportRequest(c, free.table)).toEqual({
      fileName: 'Trip cut',
      preset: 'high',
      loudness: '',
      resolution: 1080,
      captionsMode: 'burn_in',
      outputPreset: 'mp4_h264',
    });
    expect(exportProps(c, free.table, 'pop')).toEqual({
      preset: 'high',
      format: 'h264',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrate: 192,
      audioChannels: 2,
      mode: 'preset',
      resolution: '1080p',
      captionsMode: 'burn_in',
      captionAnimation: 'pop',
      host: 'mm',
    });
  });
});

describe('export model', () => {
  const t = premium.table;
  const access = accessOf(premium);
  const base = defaultChoices(t, access, 'cut', true);

  it('audio-only outputs drop resolution and captions', () => {
    expect(buildExportRequest({ ...base, outputPreset: 'audio_mp3', resolution: 2160 }, t)).toEqual(
      {
        fileName: 'cut',
        preset: 'high',
        loudness: '',
        resolution: 0,
        captionsMode: 'none',
        outputPreset: 'audio_mp3',
      },
    );
  });

  it('Advanced sends the explicit parts, bitrate/channels only when not the default', () => {
    const adv: ExportChoices = {
      ...base,
      mode: 'advanced',
      output: {
        container: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'mp3',
        audioBitrate: 320,
        audioChannels: 1,
      },
    };
    expect(buildExportRequest(adv, t)).toEqual({
      fileName: 'cut',
      preset: 'high',
      loudness: '',
      resolution: 0,
      captionsMode: 'burn_in',
      container: 'mkv',
      videoCodec: 'h264',
      audioCodec: 'mp3',
      audioBitrate: 320,
      audioChannels: 1,
    });
    // An Advanced choice equal to a preset is that preset.
    const same = {
      ...adv,
      output: {
        container: 'mov',
        videoCodec: 'hevc',
        audioCodec: 'aac',
        audioBitrate: 192,
        audioChannels: 2,
      },
    };
    expect(buildExportRequest(same, t)).toMatchObject({ outputPreset: 'mov_hevc' });
    expect(choiceLock(adv, free.table, accessOf(free))).toMatchObject({ option: 'mkv' });
  });

  it('embedded captions are gated by subs_embedded', () => {
    const emb = {
      ...defaultChoices(free.table, accessOf(free), 'x', true),
      captionsMode: 'embedded' as const,
    };
    expect(choiceLock(emb, free.table, accessOf(free))).toEqual({
      option: 'subs_embedded',
      required: 'premium',
    });
    expect(choiceLock(emb, t, access)).toBeNull();
  });
});
