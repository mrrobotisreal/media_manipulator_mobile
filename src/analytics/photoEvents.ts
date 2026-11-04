/**
 * Aperture analytics (ticket MA50 decision 10, design PHOTO_EDITOR.md §10): `photo_*` through
 * `EVENTS` only; `context.tool_slug` = `aperture` (MA52's preset rows pass their own slug).
 * Props are enums and buckets (`src/photo/exportPlan.ts` buckets = the web's).
 */
import type { JobRecord } from '@/jobs/types';
import { isPhotoExportOptions } from '@/jobs/starters/photoExport';
import {
  batchBucket,
  bytesBucket,
  countBucket,
  maskCount,
  msBucket,
  photoMegapixelBucket,
} from '@/photo/exportPlan';
import type { PhotoDoc } from '@/photo/photoTypes';
import {
  EVENTS,
  type PhotoEditorSource,
  type PhotoFailReason,
  type PhotoFormatProp,
} from './events';
import { track } from './track';

export const PHOTO_TOOL_SLUG = 'aperture';
export const ADJUSTMENT_DEBOUNCE_MS = 600;

const ctx = (slug = PHOTO_TOOL_SLUG) => ({ tool_slug: slug, feature: 'photo' });

export function trackPhotoEditorOpened(
  source: PhotoEditorSource,
  localDecode: boolean,
  slug?: string,
): void {
  track(EVENTS.PHOTO_EDITOR_OPENED, { source, local_decode: localDecode }, ctx(slug));
}

const EXT_FORMAT: Record<string, string> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  tif: 'tiff',
  tiff: 'tiff',
  heic: 'heic',
  heif: 'heic',
  gif: 'gif',
  bmp: 'bmp',
};
/** `source_format` from an extension (closed vocabulary; never the file name). */
export const sourceFormatOf = (ext: string) => EXT_FORMAT[ext.toLowerCase()] ?? 'other';

export function trackPhotoProjectCreated(
  ext: string,
  megapixels: number,
  hasAlpha: boolean,
  slug?: string,
): void {
  track(
    EVENTS.PHOTO_PROJECT_CREATED,
    {
      source_format: sourceFormatOf(ext),
      megapixels_bucket: photoMegapixelBucket(megapixels),
      has_alpha: hasAlpha,
    },
    ctx(slug),
  );
}

export function trackPhotoProjectSaved(doc: PhotoDoc, slug?: string): void {
  track(
    EVENTS.PHOTO_PROJECT_SAVED,
    {
      layers: countBucket(doc.layers.length),
      masks: countBucket(maskCount(doc)),
      heals: countBucket(doc.heals.length),
      doc_bytes_bucket: bytesBucket(JSON.stringify(doc).length),
    },
    ctx(slug),
  );
}

export function trackPhotoCompareUsed(mode: 'hold' | 'split' | 'wipe', slug?: string): void {
  track(EVENTS.PHOTO_COMPARE_USED, { mode }, ctx(slug));
}

/** `photo_adjustment_changed`: one event per (type, param) per 600 ms of quiet; keys only. */
export function createAdjustmentTracker(
  emit: (adjustment: string, param: string) => void = (adjustment, param) =>
    track(EVENTS.PHOTO_ADJUSTMENT_CHANGED, { adjustment, param }, ctx()),
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = {
    set: setTimeout,
    clear: clearTimeout,
  },
) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    note(adjustment: string, param: string) {
      const key = `${adjustment}.${param}`;
      const t = pending.get(key);
      if (t) timers.clear(t);
      pending.set(
        key,
        timers.set(() => {
          pending.delete(key);
          emit(adjustment, param);
        }, ADJUSTMENT_DEBOUNCE_MS),
      );
    },
    dispose() {
      pending.forEach((t) => timers.clear(t));
      pending.clear();
    },
  };
}

export function trackPhotoExportStarted(
  doc: PhotoDoc,
  format: PhotoFormatProp,
  megapixels: number,
  slug?: string,
): void {
  track(
    EVENTS.PHOTO_EXPORT_STARTED,
    {
      format,
      megapixels_bucket: photoMegapixelBucket(megapixels),
      layers: countBucket(doc.layers.length),
      masks: countBucket(maskCount(doc)),
      batch_size: batchBucket(1),
    },
    ctx(slug),
  );
}

/** Map an `MmError` code / HTTP status to the catalog's reason vocabulary (the web's `failReason`). */
export function photoFailReason(
  code: string | undefined,
  status?: number | string,
): PhotoFailReason {
  const r = (code ?? '').toLowerCase();
  if (r.includes('quota')) return 'quota';
  if (status === 429 || r.includes('rate') || r.includes('limit')) return 'limit';
  if (status === 403 || r.includes('locked') || r.includes('forbidden') || r.includes('signin'))
    return 'locked';
  if (r.includes('cancel') || r.includes('abort')) return 'cancelled';
  if (r.includes('timeout') || status === 504 || status === 408) return 'timeout';
  if (status === 413 || r.includes('too_large') || r.includes('too_many_pixels'))
    return 'too_large';
  if (status === 415 || status === 422 || r.includes('unsupported') || r.includes('invalid'))
    return 'unsupported';
  if (
    r === 'network' ||
    status === 502 ||
    status === 503 ||
    r.includes('unavailable') ||
    r.includes('disabled')
  )
    return 'unavailable';
  if (r.includes('render') || r === 'failed') return 'render';
  return 'error';
}

/**
 * The export job ended (the `photoExport` starter's `settled` hook, after the engine's own
 * job_completed / job_failed): one photo_export_completed or photo_export_failed per export.
 */
export function trackPhotoExportSettled(rec: JobRecord, now = Date.now()): void {
  const o = rec.options;
  if (!isPhotoExportOptions(o)) return;
  const format = o.body.format;
  const base = {
    format,
    megapixels_bucket: photoMegapixelBucket(o.megapixels),
    ms: msBucket(now - rec.createdAt),
  };
  const c = { ...ctx(rec.analyticsSlug), ...(rec.jobId ? { job_id: rec.jobId } : {}) };
  if (rec.state === 'completed') {
    const bytes = rec.job?.resultSizeBytes;
    track(
      EVENTS.PHOTO_EXPORT_COMPLETED,
      { ...base, ...(typeof bytes === 'number' ? { bytes_bucket: bytesBucket(bytes) } : {}) },
      c,
    );
    return;
  }
  const reason =
    rec.state === 'failed' ? 'render' : photoFailReason(rec.error?.code, rec.error?.status);
  track(EVENTS.PHOTO_EXPORT_FAILED, { ...base, reason }, c);
}

/* MA51: masks, AI masks, heal, presets (names mirrored from MM101's catalog by MA50). */

export type PhotoMaskKind =
  'gradient' | 'radial' | 'brush' | 'luminosity' | 'colorRange' | 'subject';

export function trackPhotoMaskAdded(kind: PhotoMaskKind, slug?: string): void {
  track(EVENTS.PHOTO_MASK_ADDED, { mask_kind: kind }, ctx(slug));
}

/** One AI subject request: requested now, completed / failed with an ms bucket when it settles. */
export function trackPhotoAiMask(slug?: string, now: () => number = Date.now) {
  const t0 = now();
  track(EVENTS.PHOTO_AI_MASK_REQUESTED, {}, ctx(slug));
  return {
    completed: () => track(EVENTS.PHOTO_AI_MASK_COMPLETED, { ms: msBucket(now() - t0) }, ctx(slug)),
    failed: (reason: PhotoFailReason) =>
      track(EVENTS.PHOTO_AI_MASK_FAILED, { ms: msBucket(now() - t0), reason }, ctx(slug)),
  };
}

/** One Heal press (`ai_ops`): requested now, completed / failed when the job settles. */
export function trackPhotoHeal(slug?: string, now: () => number = Date.now) {
  const t0 = now();
  track(EVENTS.PHOTO_HEAL_REQUESTED, {}, ctx(slug));
  return {
    completed: () => track(EVENTS.PHOTO_HEAL_COMPLETED, { ms: msBucket(now() - t0) }, ctx(slug)),
    failed: (reason: PhotoFailReason) =>
      track(EVENTS.PHOTO_HEAL_FAILED, { ms: msBucket(now() - t0), reason }, ctx(slug)),
  };
}

/** A look applied: built-in id, or `custom` for a user preset (scope `local`: on this device). */
export function trackPhotoPresetApplied(presetId: string, builtin: boolean, slug?: string): void {
  track(
    EVENTS.PHOTO_PRESET_APPLIED,
    { preset_id: builtin ? presetId : 'custom', builtin, scope: builtin ? 'builtin' : 'local' },
    ctx(slug),
  );
}
