import { TOOL_BY_ID, toolsByFamily } from '../registry';
import {
  ADJUST_DEFAULTS,
  CONVERT_DEFAULTS,
  SPEED_DEFAULTS,
  TRANSFORM_DEFAULTS,
} from '../options/video';
import { WEB_TOOL_ALIASES, WEB_TOOL_SLUGS } from '../__fixtures__/webTools';

const slugOf = (id: string, form: object) => {
  const t = TOOL_BY_ID.get(id)!;
  return t.analyticsSlugFor ? t.analyticsSlugFor(form) : t.analyticsSlug;
};

describe('video rows', () => {
  it('are presigned, ops-metered, ten of them', () => {
    const rows = toolsByFamily('video');
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.endpoint).toBe('presign');
      expect(r.metric).toBe('ops');
      expect(r.gpu).toBe(false);
      expect(r.Form.name).not.toBe('DefaultsForm');
    }
  });

  it('analyticsSlugFor table (decision 9)', () => {
    expect(slugOf('video-convert', CONVERT_DEFAULTS)).toBe('video-converter');
    expect(slugOf('video-convert', { ...CONVERT_DEFAULTS, codec: 'h265' })).toBe(
      'convert-video-to-hevc',
    );
    expect(slugOf('video-compress', {})).toBe('compress-video');
    expect(slugOf('video-trim', {})).toBe('video-trimmer');
    expect(slugOf('video-to-gif', {})).toBe('convert-video-to-animated-gif');
    expect(slugOf('video-extract-audio', {})).toBe('extract-audio-from-video');
    expect(slugOf('video-remove-audio', {})).toBe('remove-audio-from-video');
    expect(slugOf('video-extract-frames', {})).toBe('extract-frames-from-video');
    expect(slugOf('video-transform', TRANSFORM_DEFAULTS)).toBe('resize-video');
    expect(slugOf('video-transform', { ...TRANSFORM_DEFAULTS, op: 'rotate' })).toBe('rotate-video');
    expect(
      slugOf('video-transform', {
        ...TRANSFORM_DEFAULTS,
        op: 'rotate',
        rotation: 0,
        flipVertical: true,
      }),
    ).toBe('flip-video');
    expect(slugOf('video-transform', { ...TRANSFORM_DEFAULTS, op: 'crop' })).toBe('crop-video');
    expect(slugOf('video-speed', SPEED_DEFAULTS)).toBe('change-video-speed');
    expect(slugOf('video-speed', { ...SPEED_DEFAULTS, reverse: true })).toBe('reverse-video');
    expect(slugOf('video-adjust', ADJUST_DEFAULTS)).toBe('stabilize-video');
    expect(slugOf('video-adjust', { ...ADJUST_DEFAULTS, adjust: 'frameRate' })).toBe(
      'change-video-frame-rate',
    );
    expect(slugOf('video-adjust', { ...ADJUST_DEFAULTS, adjust: 'color' })).toBe(
      'adjust-video-color',
    );
  });

  it('every analytics slug the rows can emit is a real, non-alias web slug', () => {
    for (const r of toolsByFamily('video')) {
      for (const p of r.presets ?? []) {
        expect(WEB_TOOL_SLUGS).toContain(p.analyticsSlug);
        expect(WEB_TOOL_ALIASES).not.toContain(p.analyticsSlug);
      }
    }
  });

  it('presets cover every folded web slug of the family', () => {
    const folded = [
      'video-converter',
      'mp4-converter',
      'convert-mov-to-mp4',
      'convert-webm-to-mp4',
      'convert-avi-to-mp4',
      'convert-mkv-to-mp4',
      'convert-mp4-to-webm',
      'convert-video-to-hevc',
      'compress-video',
      'video-compressor',
      'compress-mp4',
      'video-trimmer',
      'mp4-trimmer',
      'video-cutter',
      'cut-video-online',
      'convert-video-to-animated-gif',
      'video-to-gif',
      'mp4-to-gif',
      'gif-converter',
      'extract-audio-from-video',
      'video-to-mp3',
      'mp4-to-mp3',
      'remove-audio-from-video',
      'extract-video-only-from-video',
      'extract-frames-from-video',
      'resize-video',
      'rotate-video',
      'flip-video',
      'crop-video',
      'change-video-speed',
      'reverse-video',
      'stabilize-video',
      'change-video-frame-rate',
      'adjust-video-color',
    ];
    const ids = toolsByFamily('video').flatMap((r) => (r.presets ?? []).map((p) => p.id));
    expect(ids.sort()).toEqual([...folded].sort());
  });

  it('default builds satisfy the required keys', () => {
    for (const id of ['video-convert', 'video-compress', 'video-to-gif', 'video-speed']) {
      const t = TOOL_BY_ID.get(id)!;
      expect(t.optionsBuilder(t.defaults)).toMatchObject({
        quality: expect.any(String),
        speed: expect.any(Number),
        preserveAspectRatio: true,
      });
    }
  });
});
