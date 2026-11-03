import type { RetentionPreview } from '@/api/schemas/accountSettings';
import {
  isShrink,
  parseCustomDays,
  presetForHours,
  previewTotal,
  RETENTION_PRESETS,
  retentionBucket,
} from '../retention';

describe('retention helpers (ports of the web)', () => {
  it('retention presets and clamp match the web', () => {
    expect(RETENTION_PRESETS.map((p) => [p.id, p.hours])).toEqual([
      ['h24', 24],
      ['d7', 168],
      ['d30', 720],
      ['d90', 2160],
      ['m6', 4320],
      ['y1', 8760],
      ['y2', 17520],
    ]);
    expect(presetForHours(4320)).toBe('m6');
    expect(presetForHours(100)).toBeNull();
    expect(parseCustomDays('10')).toEqual({ ok: true, days: 10, hours: 240 });
    expect(parseCustomDays(' 730 ')).toEqual({ ok: true, days: 730, hours: 17520 });
    expect(parseCustomDays('0')).toEqual({ ok: false });
    expect(parseCustomDays('731')).toEqual({ ok: false });
    expect(parseCustomDays('1.5')).toEqual({ ok: false });
    expect(parseCustomDays('abc')).toEqual({ ok: false });
    // server limits win over the day bounds
    expect(parseCustomDays('1', { minHours: 48, maxHours: 17520 })).toEqual({
      ok: true,
      days: 1,
      hours: 48,
    });
    expect(parseCustomDays('700', { minHours: 24, maxHours: 4320 })).toEqual({
      ok: true,
      days: 700,
      hours: 4320,
    });
  });

  it('retentionBucket matches the web buckets', () => {
    expect([24, 168, 720, 2160, 4320, 8760, 17520, 5, 240].map((h) => retentionBucket(h))).toEqual([
      '24h',
      '7d',
      '30d',
      '90d',
      '6mo',
      '1y',
      '2y',
      'custom',
      'custom',
    ]);
  });

  it('previewTotal sums results, projects and other; only a smaller window is a shrink', () => {
    const p: RetentionPreview = {
      wouldDelete: { results: 2, projects: 1, other: 3, bytes: 99 },
      earliestDeletionAt: null,
    };
    expect(previewTotal(p)).toBe(6);
    expect(isShrink(4320, 168)).toBe(true);
    expect(isShrink(168, 4320)).toBe(false);
    expect(isShrink(168, 168)).toBe(false);
  });
});
