/**
 * MA51 analytics (ticket decision 10): mask kinds, the AI-subject and heal request → completed /
 * failed pairs with ms buckets and the catalog's reason vocabulary, preset applied (a user preset
 * reports `custom`, scope `local`). Props are the MM101 catalog's (`__fixtures__` pins names).
 */
import { track } from '@/analytics/track';
import {
  trackPhotoAiMask,
  trackPhotoHeal,
  trackPhotoMaskAdded,
  trackPhotoPresetApplied,
  trackPhotoPresetSaved,
  trackPhotoPresetsMigrated,
} from '../photoEvents';
import catalog from '../../../__fixtures__/analytics-catalog.fixture.json';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const calls = () => (track as jest.Mock).mock.calls.map((c) => [c[0], c[1], c[2]?.tool_slug]);
beforeEach(() => (track as jest.Mock).mockClear());

const catalogProps = (name: string) =>
  (catalog as unknown as Record<string, { props: string[] } | undefined>)[name]?.props;

describe('MA51 photo analytics', () => {
  it('mask added carries the kind only', () => {
    trackPhotoMaskAdded('colorRange');
    expect(calls()).toEqual([['photo_mask_added', { mask_kind: 'colorRange' }, 'aperture']]);
  });

  it('AI subject: requested, then completed or failed with an ms bucket', () => {
    let t = 0;
    const now = () => t;
    const a = trackPhotoAiMask(undefined, now);
    t = 2500;
    a.completed();
    const b = trackPhotoAiMask('remove-background', now);
    t = 2600;
    b.failed('quota');
    expect(calls()).toEqual([
      ['photo_ai_mask_requested', {}, 'aperture'],
      ['photo_ai_mask_completed', { ms: '1-5s' }, 'aperture'],
      ['photo_ai_mask_requested', {}, 'remove-background'],
      ['photo_ai_mask_failed', { ms: '100ms-1s', reason: 'quota' }, 'remove-background'],
    ]);
  });

  it('heal: requested, then completed / failed', () => {
    let t = 0;
    const h = trackPhotoHeal(undefined, () => t);
    t = 40_000;
    h.completed();
    trackPhotoHeal(undefined, () => t).failed('render');
    expect(calls().map((c) => c[0])).toEqual([
      'photo_heal_requested',
      'photo_heal_completed',
      'photo_heal_requested',
      'photo_heal_failed',
    ]);
  });

  it('preset applied: built-in id, or custom + local for a device preset', () => {
    trackPhotoPresetApplied('vintage', true);
    trackPhotoPresetApplied('up-xyz', false);
    expect(calls()).toEqual([
      [
        'photo_preset_applied',
        { preset_id: 'vintage', builtin: true, scope: 'builtin' },
        'aperture',
      ],
      ['photo_preset_applied', { preset_id: 'custom', builtin: false, scope: 'local' }, 'aperture'],
    ]);
  });

  it('MA53: account presets report scope server; saved / migrated carry buckets only', () => {
    trackPhotoPresetApplied('custom', 'server');
    trackPhotoPresetApplied('custom', 'local');
    trackPhotoPresetApplied('warm', 'builtin');
    trackPhotoPresetSaved(12, 'aperture');
    trackPhotoPresetsMigrated(3, false);
    trackPhotoPresetsMigrated(0, true);
    expect(calls()).toEqual([
      [
        'photo_preset_applied',
        { preset_id: 'custom', builtin: false, scope: 'server' },
        'aperture',
      ],
      ['photo_preset_applied', { preset_id: 'custom', builtin: false, scope: 'local' }, 'aperture'],
      ['photo_preset_applied', { preset_id: 'warm', builtin: true, scope: 'builtin' }, 'aperture'],
      ['photo_preset_saved', { builtin: false, scope: 'server', layers: '11-50' }, 'aperture'],
      ['photo_presets_migrated', { count: '1-10', declined: false }, 'aperture'],
      ['photo_presets_migrated', { count: '0', declined: true }, 'aperture'],
    ]);
    for (const [name, props] of calls())
      for (const k of Object.keys(props as object))
        expect([name, catalogProps(name as string)]).toEqual([name, expect.arrayContaining([k])]);
  });

  it('every prop sent is a catalog prop', () => {
    trackPhotoMaskAdded('brush');
    trackPhotoAiMask().failed('error');
    trackPhotoHeal().completed();
    trackPhotoPresetApplied('warm', true);
    for (const [name, props] of calls()) {
      const allowed = catalogProps(name as string);
      expect([name, allowed]).not.toEqual([name, undefined]);
      for (const k of Object.keys(props as object))
        expect([name, k, allowed!.includes(k)]).toEqual([name, k, true]);
    }
  });
});
