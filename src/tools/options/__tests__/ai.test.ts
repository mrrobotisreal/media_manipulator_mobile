import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { quotaMetricForJob } from '../../metric';
import { TOOL_BY_ID } from '../../registry';
import { resolveTransport } from '../../resolveTransport';
import type { MediaKind, ToolContext } from '../../types';
import * as b from '../ai';

const DIR = join(__dirname, '..', '__golden__');

/** Compares to `__golden__/<name>.json`; `UPDATE_GOLDEN=1` (re)writes it. */
function golden(name: string, value: unknown) {
  const file = join(DIR, `${name}.json`);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  expect(existsSync(file)).toBe(true);
  expect(value).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

const ctx = (name: string, mediaKind: MediaKind, extra: Partial<ToolContext['input']> = {}) => {
  const extension = name.split('.').pop()!;
  return { input: { name, extension, mime: '', mediaKind, uri: `file:///${name}`, ...extra } } as ToolContext;
};

const detection = (fileUri: string): b.FaceDetectionState => ({
  sessionId: 'fd_1',
  expiresAt: '2026-11-02T12:30:00Z',
  imageWidth: 100,
  imageHeight: 80,
  faces: [
    { id: 'face_1', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    { id: 'face_2', x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
  ],
  fileUri,
});

describe('AI option builders (golden)', () => {
  it('remove-background.default', () =>
    golden('remove-background.default', b.buildRemoveBackgroundOptions(b.removeBackgroundDefaults)));
  it('upscale.2x-anime', () =>
    golden(
      'upscale.2x-anime',
      b.buildUpscaleOptions({ scale: 2, model: 'realesrgan-x4plus-anime' }),
    ));
  it('blur-faces.all (no session id)', () => {
    const o = b.buildBlurFacesOptions(b.blurFacesDefaults, ctx('a.heic', 'image'));
    expect((o.ai as any).faceSelection).toEqual({ selectionMode: 'all' });
    golden('blur-faces.all', o);
  });
  it('blur-faces.only-selected', () => {
    const c = ctx('a.jpg', 'image');
    golden(
      'blur-faces.only-selected',
      b.buildBlurFacesOptions(
        {
          style: 'pixelate',
          selectionMode: 'only_selected',
          detection: detection(c.input!.uri!),
          selected: ['face_2'],
        },
        c,
      ),
    );
  });
  it('blur-faces.all-except', () => {
    const c = ctx('a.png', 'image');
    golden(
      'blur-faces.all-except',
      b.buildBlurFacesOptions(
        {
          style: 'blackbox',
          selectionMode: 'all_except_selected',
          detection: detection(c.input!.uri!),
          selected: ['face_1'],
        },
        c,
      ),
    );
  });
  it('a detection made on another file is ignored and blocks Run', () => {
    const f: b.BlurFacesForm = {
      ...b.blurFacesDefaults,
      selectionMode: 'only_selected',
      detection: detection('file:///other.jpg'),
      selected: ['face_1'],
    };
    const c = ctx('a.jpg', 'image');
    expect(b.blurFacesBlockReason(f, c)).toBe('needs_detection');
    expect((b.buildBlurFacesOptions(f, c).ai as any).faceSelection.sessionId).toBeUndefined();
  });
  it('only_selected blocks on an empty selection; all_except does not', () => {
    const c = ctx('a.jpg', 'image');
    const f: b.BlurFacesForm = {
      ...b.blurFacesDefaults,
      selectionMode: 'only_selected',
      detection: detection(c.input!.uri!),
      selected: [],
    };
    expect(b.blurFacesBlockReason(f, c)).toBe('select_faces');
    expect(b.blurFacesBlockReason({ ...f, selectionMode: 'all_except_selected' }, c)).toBeNull();
    expect(b.blurFacesBlockReason(b.blurFacesDefaults, c)).toBeNull();
  });
  it('redact-text.all-text-blur', () =>
    golden(
      'redact-text.all-text-blur',
      b.buildRedactTextOptions({ detect: 'all-text', style: 'blur' }, ctx('shot.png', 'image')),
    ));
  it('remove-object.two-rects (4-decimal rounding)', () =>
    golden(
      'remove-object.two-rects',
      b.buildRemoveObjectOptions(
        {
          rects: [
            { id: 'a', x: 0.123456, y: 0.2, width: 0.333333, height: 0.1 },
            { id: 'b', x: 0.5, y: 0.5000049, width: 0.25, height: 0.2499999 },
          ],
        },
        ctx('a.webp', 'image'),
      ),
    ));
  it('remove-object needs a rectangle', () => {
    expect(b.removeObjectBlockReason({ rects: [] })).toBe('needs_rect');
    expect(
      b.removeObjectBlockReason({ rects: [{ id: 'a', x: 0, y: 0, width: 0.1, height: 0.1 }] }),
    ).toBeNull();
  });
  it('clean-voice.m4a-input (format aac)', () =>
    golden('clean-voice.m4a-input', b.buildVoiceOptions('clean_voice', ctx('memo.m4a', 'audio'))));
  it('remove-noise.wav', () =>
    golden(
      'remove-noise.wav',
      b.buildVoiceOptions('remove_background_noise', ctx('memo.wav', 'audio')),
    ));
  it('isolate-vocals.audio-auto sends "auto" over upload', () => {
    const o = b.buildStemOptions('isolate_vocals', b.stemDefaults, ctx('song.mp3', 'audio'));
    expect(o.format).toBe('auto');
    golden('isolate-vocals.audio-auto', o);
  });
  it('isolate-vocals.video-mp3 sends the concrete format, never "auto"', () => {
    const o = b.buildStemOptions('isolate_vocals', b.stemDefaults, ctx('clip.mp4', 'video'));
    expect(o.format).toBe('mp3');
    golden('isolate-vocals.video-mp3', o);
    expect(resolveTransport(TOOL_BY_ID.get('isolate-vocals')!, 'video')).toBe('presign');
  });
  it('a video with an explicit pick keeps it', () => {
    expect(
      b.buildStemOptions('remove_vocals', { output: 'flac' }, ctx('clip.mov', 'video')).format,
    ).toBe('flac');
  });
  it('remove-vocals.flac', () =>
    golden(
      'remove-vocals.flac',
      b.buildStemOptions('remove_vocals', { output: 'flac' }, ctx('song.wav', 'audio')),
    ));
  it('frame-interpolation.60-720', () =>
    golden(
      'frame-interpolation.60-720',
      b.buildFrameInterpolationOptions(b.frameInterpolationDefaults),
    ));
  it('frame-interpolation blocks a 150 s clip, allows 120 s', () => {
    const f = b.frameInterpolationDefaults;
    expect(b.frameInterpolationBlockReason(f, ctx('a.mp4', 'video', { durationSec: 150 }))).toBe(
      'too_long',
    );
    expect(b.frameInterpolationBlockReason(f, ctx('a.mp4', 'video', { durationSec: 120 }))).toBeNull();
    expect(b.frameInterpolationBlockReason(f, ctx('a.mp4', 'video'))).toBeNull();
  });
  it('transcribe.vtt-auto has no language key', () => {
    const o = b.buildTranscribeOptions(b.transcribeDefaults);
    expect(o).not.toHaveProperty('language');
    golden('transcribe.vtt-auto', o);
  });
  it('transcribe.srt-de', () =>
    golden('transcribe.srt-de', b.buildTranscribeOptions({ format: 'srt', language: ' DE ' })));
  it('transcribe language validation and slugs', () => {
    expect(b.transcribeBlockReason({ format: 'vtt', language: 'x1' })).toBe('bad_language');
    expect(b.transcribeBlockReason({ format: 'vtt', language: 'haw' })).toBeNull();
    expect(b.transcribeSlug(b.transcribeDefaults, ctx('a.mp4', 'video'))).toBe('transcribe-video');
    expect(b.transcribeSlug(b.transcribeDefaults, ctx('a.mp3', 'audio'))).toBe('transcribe-audio');
    expect(b.transcribeSlug({ ...b.transcribeDefaults, slugHint: 'srt-generator' })).toBe(
      'srt-generator',
    );
  });
  it('same-format rules (MA17 decision 4 / MA19 decision 4)', () => {
    expect(b.sameImageFormat('jpeg')).toBe('jpg');
    expect(b.sameImageFormat('HEIC')).toBe('jpg');
    expect(b.sameImageFormat('webp')).toBe('webp');
    expect(b.sameAudioFormat('m4a')).toBe('aac');
    expect(b.sameAudioFormat('opus')).toBe('opus');
    expect(b.sameAudioFormat('wma')).toBe('mp3');
  });
});

// Metric + endpoint tables (decisions 3 and 4).
const AI_IDS = [
  'remove-background',
  'upscale',
  'blur-faces',
  'redact-text',
  'remove-object',
  'clean-voice',
  'remove-noise',
  'isolate-vocals',
  'remove-vocals',
  'frame-interpolation',
  'transcribe',
] as const;

describe('quota metric table (decision 4)', () => {
  const OPS = ['remove-background', 'clean-voice', 'remove-noise'];
  it.each(AI_IDS)('%s: row metric and the built options agree', (id) => {
    const tool = TOOL_BY_ID.get(id)!;
    const kind = tool.accepts.kinds[0];
    const options = tool.optionsBuilder(tool.defaults, ctx(`a.${kind === 'image' ? 'jpg' : kind === 'audio' ? 'mp3' : 'mp4'}`, kind));
    const expected = OPS.includes(id) ? 'ops' : 'ai_ops';
    expect(tool.metric).toBe(expected);
    expect(quotaMetricForJob(options)).toBe(expected);
    expect(tool.gpu).toBe(true);
  });
});

describe('endpoint per input table (decision 3)', () => {
  const rows: [string, MediaKind, string][] = [
    ['remove-background', 'image', 'upload'],
    ['upscale', 'image', 'upload'],
    ['blur-faces', 'image', 'upload'],
    ['redact-text', 'image', 'upload'],
    ['remove-object', 'image', 'upload'],
    ['clean-voice', 'audio', 'upload'],
    ['remove-noise', 'audio', 'upload'],
    ['isolate-vocals', 'audio', 'upload'],
    ['isolate-vocals', 'video', 'presign'],
    ['remove-vocals', 'audio', 'upload'],
    ['remove-vocals', 'video', 'presign'],
    ['frame-interpolation', 'video', 'presign'],
    ['transcribe', 'audio', 'upload'],
    ['transcribe', 'video', 'presign'],
  ];
  it.each(rows)('%s + %s -> %s', (id, kind, want) => {
    const tool = TOOL_BY_ID.get(id)!;
    expect(tool.accepts.kinds).toContain(kind);
    expect(resolveTransport(tool, kind)).toBe(want);
  });
  it('server limits and slugs', () => {
    expect(TOOL_BY_ID.get('frame-interpolation')!.serverLimits).toEqual({
      maxSeconds: 120,
      maxHeight: 720,
    });
    const t = TOOL_BY_ID.get('transcribe')!;
    expect(t.analyticsSlugFor!({ ...b.transcribeDefaults, slugHint: 'generate-vtt-captions' })).toBe(
      'generate-vtt-captions',
    );
  });
});
