import { useCallback, useState } from 'react';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import type { RetentionPreview, SettingsPatch } from '@/api/schemas/accountSettings';
import { isShrink, previewTotal, retentionBucket } from './retention';

export interface RetentionSaveDeps {
  /** Current stored window (hours). */
  current: number;
  preview: (hours: number) => Promise<RetentionPreview>;
  patch: (body: SettingsPatch) => Promise<unknown>;
}

export type RetentionSaveOutcome =
  | { status: 'saved' }
  | { status: 'confirm'; preview: RetentionPreview }
  | { status: 'previewFailed' }
  | { status: 'saveFailed' };

/**
 * Pure flow: only a SHORTER window is previewed (it can delete files now); when the preview counts
 * items the caller must show the confirm sheet and call `commitRetention`. A longer or equal window
 * saves directly. The preview is never skipped for a shrink.
 */
export async function requestRetention(
  hours: number,
  deps: RetentionSaveDeps,
): Promise<RetentionSaveOutcome> {
  if (isShrink(deps.current, hours)) {
    let preview: RetentionPreview;
    try {
      preview = await deps.preview(hours);
    } catch {
      return { status: 'previewFailed' };
    }
    if (previewTotal(preview) > 0) return { status: 'confirm', preview };
  }
  return commitRetention(hours, deps);
}

/** PATCH the window, then `retention_setting_changed {from_bucket, to_bucket}`. */
export async function commitRetention(
  hours: number,
  deps: Pick<RetentionSaveDeps, 'current' | 'patch'>,
): Promise<RetentionSaveOutcome> {
  try {
    await deps.patch({ retentionHours: hours });
  } catch {
    return { status: 'saveFailed' };
  }
  track(EVENTS.RETENTION_SETTING_CHANGED, {
    from_bucket: retentionBucket(deps.current),
    to_bucket: retentionBucket(hours),
  });
  return { status: 'saved' };
}

/** Busy flag around the async flow for the screen. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
