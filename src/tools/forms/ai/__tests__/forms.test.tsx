import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import * as o from '../../../options/ai';
import { TOOL_BY_ID } from '../../../registry';
import type { ToolContext } from '../../../types';
import { ensureFreshDetection, faceCountBucket, isExpired } from '../faceSession';
import { FrameInterpolationForm, StemForm, TranscribeForm } from '../MediaAiForms';
import { BlurFacesForm } from '../ImageAiForms';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

async function wrap(ui: React.ReactElement) {
  const { store } = await makeReadyStore();
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
}

const ctx = (name: string, mediaKind: 'image' | 'video' | 'audio', extra = {}): ToolContext => ({
  input: {
    name,
    extension: name.split('.').pop()!,
    mime: mediaKind === 'video' ? 'video/mp4' : '',
    mediaKind,
    uri: `file:///${name}`,
    ...extra,
  },
});

const detection = (fileUri: string, expiresAt: string): o.FaceDetectionState => ({
  sessionId: 'fd_old',
  expiresAt,
  imageWidth: 100,
  imageHeight: 100,
  faces: [{ id: 'face_1', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
  fileUri,
});

describe('BlurFacesForm gating', () => {
  const tool = TOOL_BY_ID.get('blur-faces')!;
  it('blocks Run in only_selected without a detection', () => {
    const f: o.BlurFacesForm = { ...o.blurFacesDefaults, selectionMode: 'only_selected' };
    expect(tool.blockReason!(f, ctx('a.jpg', 'image'))).toBe('needs_detection');
  });
  it('shows the find button and the hint in a selection mode', async () => {
    await wrap(
      <BlurFacesForm
        value={{ ...o.blurFacesDefaults, selectionMode: 'only_selected' }}
        onChange={jest.fn()}
        ctx={ctx('a.jpg', 'image')}
      />,
    );
    expect(screen.getByText('Find faces')).toBeTruthy();
    expect(screen.getByText('Find faces first to choose which ones to cover.')).toBeTruthy();
  });
  it('lets "all" run with no detection at all', () => {
    expect(tool.blockReason!(o.blurFacesDefaults, ctx('a.jpg', 'image'))).toBeNull();
  });
});

describe('face session expiry (mocked clock)', () => {
  const NOW = Date.parse('2026-11-02T13:00:00Z');
  const c = ctx('a.jpg', 'image');
  const fresh = (): o.BlurFacesForm => ({
    ...o.blurFacesDefaults,
    selectionMode: 'only_selected',
    selected: ['face_1', 'gone'],
    detection: detection('file:///a.jpg', '2026-11-02T13:20:00Z'),
  });

  it('keeps a live session and does not call detect', async () => {
    const detect = jest.fn();
    const out = await ensureFreshDetection(fresh(), c, detect, NOW);
    expect(detect).not.toHaveBeenCalled();
    expect(out.detection!.sessionId).toBe('fd_old');
  });

  it('re-detects from the same cached file once expiresAt has passed, keeping ids that still exist', async () => {
    const detect = jest.fn(async () => ({
      ok: true as const,
      data: {
        faceDetectionSessionId: 'fd_new',
        imageWidth: 100,
        imageHeight: 100,
        expiresAt: '2026-11-02T13:30:00Z',
        faces: [{ id: 'face_1', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
      },
    }));
    const stale = { ...fresh(), detection: detection('file:///a.jpg', '2026-11-02T12:00:00Z') };
    expect(isExpired(stale.detection!, NOW)).toBe(true);
    const out = await ensureFreshDetection(stale, c, detect, NOW);
    expect(detect).toHaveBeenCalledWith({ uri: 'file:///a.jpg', mimeType: '' });
    expect(out.detection!.sessionId).toBe('fd_new');
    expect(out.selected).toEqual(['face_1']);
    const built = o.buildBlurFacesOptions(out, c);
    expect((built.ai as any).faceSelection.sessionId).toBe('fd_new');
  });

  it('re-detects when the detection belongs to another file', async () => {
    const detect = jest.fn(async () => ({
      ok: true as const,
      data: { faceDetectionSessionId: 'fd_n', imageWidth: 1, imageHeight: 1, expiresAt: '2099-01-01T00:00:00Z', faces: [] },
    }));
    const other = { ...fresh(), detection: detection('file:///b.jpg', '2099-01-01T00:00:00Z') };
    await ensureFreshDetection(other, c, detect, NOW);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('a failed re-detect throws so Run does not send a dead session', async () => {
    const detect = jest.fn(async () => ({
      ok: false as const,
      error: { status: 503, code: 'server_error' as const, details: {} },
    }));
    const stale = { ...fresh(), detection: null };
    await expect(ensureFreshDetection(stale, c, detect, NOW)).rejects.toThrow();
  });

  it('all mode never re-detects', async () => {
    const detect = jest.fn();
    await ensureFreshDetection(o.blurFacesDefaults, c, detect, NOW);
    expect(detect).not.toHaveBeenCalled();
  });

  it('buckets the face count for analytics', () => {
    expect([0, 1, 2, 5, 6, 40].map(faceCountBucket)).toEqual(['0', '1', '2-5', '2-5', '6+', '6+']);
  });
});

describe('FrameInterpolationForm', () => {
  const tool = TOOL_BY_ID.get('frame-interpolation')!;
  it('blocks a 150 s clip with the plain copy and allows 120 s', async () => {
    expect(tool.blockReason!(o.frameInterpolationDefaults, ctx('a.mp4', 'video', { durationSec: 150 }))).toBe('too_long');
    expect(tool.blockReason!(o.frameInterpolationDefaults, ctx('a.mp4', 'video', { durationSec: 120 }))).toBeNull();
    await wrap(
      <FrameInterpolationForm
        value={o.frameInterpolationDefaults}
        onChange={jest.fn()}
        ctx={ctx('a.mp4', 'video', { durationSec: 150 })}
      />,
    );
    expect(screen.getByTestId('interp-too-long').props.children).toContain('trim it first');
    expect(screen.getByText('Clips up to 120 s; processed at up to 720p.')).toBeTruthy();
  });
});

describe('StemForm and TranscribeForm', () => {
  it('labels "same as the original" with the resolved format', async () => {
    await wrap(
      <StemForm value={o.stemDefaults} onChange={jest.fn()} ctx={ctx('song.m4a', 'audio')} />,
    );
    expect(screen.getByText('Same as the original (M4A)')).toBeTruthy();
  });

  it('transcribe: picking a language reports it; a bad Other code blocks Run', async () => {
    const onChange = jest.fn();
    await wrap(<TranscribeForm value={o.transcribeDefaults} onChange={onChange} />);
    await act(async () => {
      fireEvent.press(screen.getByText('German'));
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: 'de' }));
    expect(TOOL_BY_ID.get('transcribe')!.blockReason!({ format: 'vtt', language: 'xx1' })).toBe('bad_language');
  });

  it('presets keep the web slugs', () => {
    const t = TOOL_BY_ID.get('transcribe')!;
    const srt = t.presets!.find((p) => p.id === 'srt-generator')!;
    expect(srt.defaults).toMatchObject({ format: 'srt' });
    expect(t.analyticsSlugFor!({ ...o.transcribeDefaults, ...srt.defaults }, ctx('a.mp3', 'audio'))).toBe('srt-generator');
  });
});
