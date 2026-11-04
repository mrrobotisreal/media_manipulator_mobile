/**
 * Pinned parity (ticket MA50 decision 10): the app mirror's photo_* names equal the design §10 list
 * (the analytics catalog's "MA52 photo" batch, MM101). MM101 has merged, so the analytics repo's
 * TestAppEventsParity already checks this file; this test pins the list here too.
 */
import { EVENTS, EVENT_PRIORITY, PRIORITY_HIGH, PRIORITY_LOW, PRIORITY_NORMAL } from '../events';
import { createAdjustmentTracker, photoFailReason, sourceFormatOf } from '../photoEvents';

const DESIGN_10 = {
  photo_editor_opened: PRIORITY_HIGH,
  photo_project_created: PRIORITY_HIGH,
  photo_adjustment_changed: PRIORITY_LOW,
  photo_mask_added: PRIORITY_NORMAL,
  photo_ai_mask_requested: PRIORITY_NORMAL,
  photo_ai_mask_completed: PRIORITY_NORMAL,
  photo_ai_mask_failed: PRIORITY_NORMAL,
  photo_heal_requested: PRIORITY_NORMAL,
  photo_heal_completed: PRIORITY_NORMAL,
  photo_heal_failed: PRIORITY_NORMAL,
  photo_preset_applied: PRIORITY_NORMAL,
  photo_compare_used: PRIORITY_LOW,
  photo_project_saved: PRIORITY_NORMAL,
  photo_export_started: PRIORITY_HIGH,
  photo_export_completed: PRIORITY_HIGH,
  photo_export_failed: PRIORITY_HIGH,
  photo_export_gated: PRIORITY_HIGH,
  // MA53: the "MA53 photo presets" batch (MM103 account presets).
  photo_preset_saved: PRIORITY_NORMAL,
  photo_presets_migrated: PRIORITY_NORMAL,
} as const;

describe('photo_* mirror', () => {
  it('equals the design §10 list (the MA52 photo + MA53 photo presets batches) with the catalog priorities', () => {
    const names = Object.values(EVENTS)
      .filter((n) => n.startsWith('photo_'))
      .sort();
    expect(names).toEqual(Object.keys(DESIGN_10).sort());
    for (const [n, p] of Object.entries(DESIGN_10))
      expect([n, EVENT_PRIORITY[n as keyof typeof EVENT_PRIORITY]]).toEqual([n, p]);
  });

  it('adjustment events are debounced 600 ms per (type, param), keys only', () => {
    jest.useFakeTimers();
    const emit = jest.fn();
    const tr = createAdjustmentTracker(emit);
    for (let i = 0; i < 20; i += 1) tr.note('exposure', 'ev');
    tr.note('tone', 'shadows');
    jest.advanceTimersByTime(599);
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(emit.mock.calls).toEqual([
      ['exposure', 'ev'],
      ['tone', 'shadows'],
    ]);
    jest.useRealTimers();
  });

  it('maps failures and source formats to closed vocabularies', () => {
    expect(photoFailReason('quota_exceeded', 429)).toBe('quota');
    expect(photoFailReason('rate_limited', 429)).toBe('limit');
    expect(photoFailReason('photo_render_unavailable', 503)).toBe('unavailable');
    expect(photoFailReason('photo_too_many_pixels', 413)).toBe('too_large');
    expect(photoFailReason('network', 'FETCH_ERROR')).toBe('unavailable');
    expect(sourceFormatOf('HEIF')).toBe('heic');
    expect(sourceFormatOf('xyz')).toBe('other');
  });
});
