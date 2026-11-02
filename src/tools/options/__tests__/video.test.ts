import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext, ToolOptions } from '../../types';
import {
  ADJUST_DEFAULTS,
  COMPRESS_DEFAULTS,
  CONVERT_DEFAULTS,
  EXTRACT_AUDIO_DEFAULTS,
  FRAMES_DEFAULTS,
  GIF_DEFAULTS,
  REMOVE_AUDIO_DEFAULTS,
  SPEED_DEFAULTS,
  TRANSFORM_DEFAULTS,
  TRIM_DEFAULTS,
  adjustValid,
  buildAdjust,
  buildCompress,
  buildConvert,
  buildExtractAudio,
  buildFrames,
  buildGif,
  buildRemoveAudio,
  buildSpeed,
  buildTransform,
  buildTrim,
  heightOverLimit,
  framesValid,
  transformValid,
  trimRangeValid,
} from '../video';
import {
  extractAudioOptionsSchema,
  extractFramesOptionsSchema,
  extractVideoOnlyOptionsSchema,
  trimVideoOptionsSchema,
  videoConversionOptionsSchema,
} from '../videoSchema';

const GOLDEN_DIR = join(__dirname, '__golden__');
const mp4: ToolContext = {
  input: { name: 'a', extension: 'mp4', mime: 'video/mp4', mediaKind: 'video', durationSec: 60 },
};
const mkv: ToolContext = {
  input: { name: 'a', extension: 'mkv', mime: 'video/mp4', mediaKind: 'video', durationSec: 60 },
};
const flv: ToolContext = {
  input: { name: 'a', extension: 'flv', mime: 'video/mp4', mediaKind: 'video', durationSec: 60 },
};

interface Case {
  name: string;
  build: () => ToolOptions;
  schema: 'conversion' | 'trim' | 'audio' | 'videoOnly' | 'frames';
}

const cases: Case[] = [
  {
    name: 'video-convert.default',
    build: () => buildConvert(CONVERT_DEFAULTS),
    schema: 'conversion',
  },
  {
    name: 'video-convert.hevc',
    build: () => buildConvert({ ...CONVERT_DEFAULTS, codec: 'h265' }),
    schema: 'conversion',
  },
  {
    name: 'video-convert.webm-no-codec',
    build: () => buildConvert({ ...CONVERT_DEFAULTS, format: 'webm', codec: 'h265' }),
    schema: 'conversion',
  },
  {
    name: 'video-compress.balanced-keep',
    build: () => buildCompress(COMPRESS_DEFAULTS),
    schema: 'conversion',
  },
  {
    name: 'video-compress.smallest-720-strip',
    build: () =>
      buildCompress({
        ...COMPRESS_DEFAULTS,
        level: 'smallest',
        resolution: '720',
        stripAudio: true,
      }),
    schema: 'conversion',
  },
  {
    name: 'video-compress.webm',
    build: () => buildCompress({ ...COMPRESS_DEFAULTS, format: 'webm', codec: 'h265' }),
    schema: 'conversion',
  },
  {
    name: 'video-trim.auto',
    build: () => buildTrim({ ...TRIM_DEFAULTS, start: 1.234, end: 9.8765 }, mp4),
    schema: 'trim',
  },
  {
    name: 'video-trim.reencode',
    build: () => buildTrim({ ...TRIM_DEFAULTS, start: 2, end: 8, reencode: true }, mkv),
    schema: 'trim',
  },
  {
    name: 'video-to-gif.trimmed-480',
    build: () => buildGif({ ...GIF_DEFAULTS, start: 0, end: 5 }, mp4),
    schema: 'conversion',
  },
  {
    name: 'video-extract-audio.m4a',
    build: () => buildExtractAudio({ ...EXTRACT_AUDIO_DEFAULTS, format: 'm4a' }),
    schema: 'audio',
  },
  {
    name: 'video-remove-audio.webm',
    build: () => buildRemoveAudio({ ...REMOVE_AUDIO_DEFAULTS, format: 'webm' }),
    schema: 'videoOnly',
  },
  {
    name: 'video-extract-frames.interval',
    build: () => buildFrames(FRAMES_DEFAULTS),
    schema: 'frames',
  },
  {
    name: 'video-extract-frames.timestamps-sorted',
    build: () =>
      buildFrames({
        ...FRAMES_DEFAULTS,
        frameMode: 'timestamp',
        timestamps: [12.5, 3, 3.001, 7.499, 3],
      }),
    schema: 'frames',
  },
  {
    name: 'video-transform.resize-width-only',
    build: () => buildTransform({ ...TRANSFORM_DEFAULTS, width: 1280 }, mp4),
    schema: 'conversion',
  },
  {
    name: 'video-transform.rotate-270-flipv',
    build: () =>
      buildTransform(
        { ...TRANSFORM_DEFAULTS, op: 'rotate', rotation: 270, flipVertical: true },
        mp4,
      ),
    schema: 'conversion',
  },
  {
    name: 'video-transform.flip-only',
    build: () =>
      buildTransform(
        { ...TRANSFORM_DEFAULTS, op: 'rotate', rotation: 0, flipHorizontal: true },
        mp4,
      ),
    schema: 'conversion',
  },
  {
    name: 'video-transform.crop',
    build: () =>
      buildTransform(
        { ...TRANSFORM_DEFAULTS, op: 'crop', crop: { x: 10.4, y: 20, width: 600.6, height: 600 } },
        mp4,
      ),
    schema: 'conversion',
  },
  {
    name: 'video-speed.half',
    build: () => buildSpeed({ ...SPEED_DEFAULTS, speed: 0.5 }, mp4),
    schema: 'conversion',
  },
  {
    name: 'video-speed.reverse',
    build: () => buildSpeed({ ...SPEED_DEFAULTS, speed: 1, reverse: true }, mp4),
    schema: 'conversion',
  },
  {
    name: 'video-adjust.stabilize',
    build: () => buildAdjust(ADJUST_DEFAULTS, mp4),
    schema: 'conversion',
  },
  {
    name: 'video-adjust.fps-30',
    build: () => buildAdjust({ ...ADJUST_DEFAULTS, adjust: 'frameRate' }, mp4),
    schema: 'conversion',
  },
  {
    name: 'video-adjust.color-only-changed-keys',
    build: () =>
      buildAdjust({ ...ADJUST_DEFAULTS, adjust: 'color', brightness: 20, saturation: -50 }, mp4),
    schema: 'conversion',
  },
];

const parse = (kind: Case['schema'], o: ToolOptions) =>
  ({
    conversion: videoConversionOptionsSchema,
    trim: trimVideoOptionsSchema,
    audio: extractAudioOptionsSchema,
    videoOnly: extractVideoOnlyOptionsSchema,
    frames: extractFramesOptionsSchema,
  })[kind].safeParse(o);

describe('video option goldens', () => {
  for (const c of cases) {
    it(c.name, () => {
      const built = c.build();
      const path = join(GOLDEN_DIR, `${c.name}.json`);
      if (process.env.UPDATE_GOLDEN === '1') {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, `${JSON.stringify(built, null, 2)}\n`);
      }
      expect(existsSync(path)).toBe(true);
      expect(built).toEqual(JSON.parse(readFileSync(path, 'utf8')));
      const r = parse(c.schema, built);
      expect(r.success).toBe(true);
    });
  }

  it('every non-mode golden carries quality, speed and preserveAspectRatio', () => {
    for (const c of cases.filter((x) => x.schema === 'conversion')) {
      const o = c.build();
      expect(typeof o.quality).toBe('string');
      expect(typeof o.speed).toBe('number');
      expect(o.speed).toBeGreaterThan(0);
      expect(typeof o.preserveAspectRatio).toBe('boolean');
      expect(o).not.toHaveProperty('mode');
    }
  });

  it('never sends forbidden keys', () => {
    for (const c of cases) {
      const o = c.build();
      for (const k of ['metadataMode', 'ai', 'advanced']) expect(o).not.toHaveProperty(k);
    }
  });

  it('the Zod port rejects the unused advanced blocks', () => {
    const o = buildConvert(CONVERT_DEFAULTS);
    expect(videoConversionOptionsSchema.safeParse({ ...o, advanced: {} }).success).toBe(false);
    expect(videoConversionOptionsSchema.safeParse({ ...o, speed: 0 }).success).toBe(false);
  });
});

describe('format rule (same as original)', () => {
  it('keeps a writable input container, else mp4', () => {
    expect(buildSpeed(SPEED_DEFAULTS, mkv).format).toBe('mkv');
    expect(buildSpeed(SPEED_DEFAULTS, flv).format).toBe('mp4');
    expect(buildTrim({ ...TRIM_DEFAULTS, start: 0, end: 1 }, mkv).format).toBe('mp4');
    expect(buildTransform({ ...TRANSFORM_DEFAULTS, width: 100 }, mkv).format).toBe('mkv');
    expect(buildSpeed(SPEED_DEFAULTS).format).toBe('mp4');
  });
});

describe('gif range', () => {
  it('omits trim when the range spans the whole clip or is unset', () => {
    expect(buildGif({ ...GIF_DEFAULTS, start: 0, end: 60 }, mp4)).not.toHaveProperty('trim');
    expect(buildGif(GIF_DEFAULTS, mp4)).not.toHaveProperty('trim');
    expect(buildGif({ ...GIF_DEFAULTS, start: 1, end: 6 }, mp4)).toHaveProperty('trim');
  });
});

describe('validators', () => {
  it('trim rejects a 0.05 s range and accepts 0.1 s', () => {
    expect(trimRangeValid(1, 1.05)).toBe(false);
    expect(trimRangeValid(1, 1.1)).toBe(true);
    expect(trimRangeValid(0, 7 * 3600)).toBe(false);
  });
  it('transform resize gates only an explicit height over the cap', () => {
    const limits = { maxOutputHeight: 720 };
    const ctx: ToolContext = { ...mp4, limits };
    expect(heightOverLimit({ ...TRANSFORM_DEFAULTS, height: 2000 }, ctx)).toBe(true);
    expect(transformValid({ ...TRANSFORM_DEFAULTS, height: 2000 }, ctx)).toBe(false);
    expect(transformValid({ ...TRANSFORM_DEFAULTS, width: 3840 }, ctx)).toBe(true);
    expect(transformValid({ ...TRANSFORM_DEFAULTS, width: 5000 }, ctx)).toBe(false);
    expect(transformValid(TRANSFORM_DEFAULTS, ctx)).toBe(false);
    expect(transformValid({ ...TRANSFORM_DEFAULTS, height: 2000 }, mp4)).toBe(true);
  });
  it('adjust colour with all defaults is invalid', () => {
    expect(adjustValid({ ...ADJUST_DEFAULTS, adjust: 'color' })).toBe(false);
    expect(adjustValid({ ...ADJUST_DEFAULTS, adjust: 'color', gamma: 1.2 })).toBe(true);
  });
  it('frames validity follows maxFrames', () => {
    expect(framesValid({ ...FRAMES_DEFAULTS, frameMode: 'timestamp', timestamps: [] })).toBe(false);
    expect(
      framesValid({
        ...FRAMES_DEFAULTS,
        frameMode: 'timestamp',
        timestamps: [1, 2, 3],
        maxFrames: 2,
      }),
    ).toBe(false);
    expect(framesValid(FRAMES_DEFAULTS)).toBe(true);
  });
});
