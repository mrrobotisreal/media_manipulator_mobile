import { preflightCount, preflightFile, type PreflightInput } from '../preflight';
import { IMAGE_ACCEPTS, VIDEO_ACCEPTS } from '@/tools/families/shared';

const limits = { maxFileBytes: 100, maxVideoSeconds: 60 };
const img = (o: Partial<PreflightInput> = {}): PreflightInput => ({
  extension: 'png',
  mimeType: 'image/png',
  mediaKind: 'image',
  sizeBytes: 10,
  ...o,
});
const vid = (o: Partial<PreflightInput> = {}): PreflightInput => ({
  extension: 'mp4',
  mimeType: 'video/mp4',
  mediaKind: 'video',
  sizeBytes: 10,
  durationSec: 5,
  ...o,
});

describe('preflightFile', () => {
  it('accepts a valid file', () => {
    expect(preflightFile(img(), IMAGE_ACCEPTS, limits)).toEqual({ ok: true });
  });

  it('unsupported_type: kind not accepted by the tool', () => {
    expect(preflightFile(vid(), IMAGE_ACCEPTS, limits)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });

  it('unsupported_type: unknown kind, and video extensions the presign route refuses', () => {
    expect(preflightFile(img({ mediaKind: null }), undefined, limits)).toMatchObject({
      reason: 'unsupported_type',
    });
    expect(preflightFile(vid({ extension: '3gp' }), undefined, limits)).toMatchObject({
      reason: 'unsupported_type',
    });
    expect(preflightFile(vid({ extension: '3gp' }), VIDEO_ACCEPTS, limits)).toMatchObject({
      reason: 'unsupported_type',
    });
  });

  it('too_large reports the limit', () => {
    expect(preflightFile(img({ sizeBytes: 101 }), IMAGE_ACCEPTS, limits)).toEqual({
      ok: false,
      reason: 'too_large',
      limit: 100,
    });
    expect(preflightFile(img({ sizeBytes: 100 }), IMAGE_ACCEPTS, limits)).toEqual({ ok: true });
  });

  it('too_long applies to video and audio, reports the limit', () => {
    expect(preflightFile(vid({ durationSec: 61 }), VIDEO_ACCEPTS, limits)).toEqual({
      ok: false,
      reason: 'too_long',
      limit: 60,
    });
    expect(
      preflightFile(
        {
          extension: 'mp3',
          mimeType: 'audio/mpeg',
          mediaKind: 'audio',
          sizeBytes: 5,
          durationSec: 90,
        },
        undefined,
        limits,
      ),
    ).toMatchObject({ reason: 'too_long' });
  });

  it('empty', () => {
    expect(preflightFile(img({ sizeBytes: 0 }), IMAGE_ACCEPTS, limits)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('precedence: unsupported > too_large > too_long > empty', () => {
    expect(
      preflightFile(vid({ sizeBytes: 999, durationSec: 999 }), IMAGE_ACCEPTS, limits),
    ).toMatchObject({
      reason: 'unsupported_type',
    });
    expect(
      preflightFile(vid({ sizeBytes: 999, durationSec: 999 }), VIDEO_ACCEPTS, limits),
    ).toMatchObject({
      reason: 'too_large',
    });
    expect(preflightFile(vid({ durationSec: 999 }), VIDEO_ACCEPTS, limits)).toMatchObject({
      reason: 'too_long',
    });
  });

  it('skips size and duration while the account snapshot is loading', () => {
    expect(
      preflightFile(vid({ sizeBytes: 1e12, durationSec: 1e6 }), VIDEO_ACCEPTS, undefined),
    ).toEqual({ ok: true });
  });

  it('a missing duration (probe failed) never blocks', () => {
    expect(preflightFile(vid({ durationSec: undefined }), VIDEO_ACCEPTS, limits)).toEqual({
      ok: true,
    });
  });

  it('unlimited (-1 / 0) limits never block', () => {
    const open = { maxFileBytes: -1, maxVideoSeconds: 0 };
    expect(preflightFile(vid({ sizeBytes: 1e12, durationSec: 1e6 }), VIDEO_ACCEPTS, open)).toEqual({
      ok: true,
    });
  });
});

describe('preflightCount', () => {
  it('rejects more than 10', () => {
    expect(preflightCount(10)).toEqual({ ok: true });
    expect(preflightCount(11)).toEqual({ ok: false, reason: 'too_many', limit: 10 });
  });
});
