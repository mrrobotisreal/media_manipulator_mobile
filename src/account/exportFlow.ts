import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { downloadExport, type ExportResult } from '@/files/exportData';
import type { SaveDeps } from '@/files/save';
import { realSaveDeps } from '@/files/saveDeps';

export type ExportFlowResult =
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'failed' };

export interface ExportFlowDeps {
  download(): Promise<ExportResult>;
  share(
    file: Extract<ExportResult, { ok: true }>['file'],
  ): Promise<'shared' | 'cancelled' | 'failed'>;
}

/**
 * Export my data: stream the zip into the cache, then hand it to the share sheet / Files (MA14 helper).
 * `data_export_requested` fires once the API accepted the request (the 200 stream started), even if the
 * user then backs out of the share sheet.
 */
export async function exportMyData(deps: ExportFlowDeps): Promise<ExportFlowResult> {
  const r = await deps.download();
  if (!r.ok) {
    if (r.error.code === 'export_rate_limited') {
      const s = Number(r.error.details.retryAfterSeconds);
      return { status: 'rate_limited', retryAfterSeconds: Number.isFinite(s) && s > 0 ? s : 3600 };
    }
    return { status: 'failed' };
  }
  track(EVENTS.DATA_EXPORT_REQUESTED, {});
  const shared = await deps.share(r.file);
  return {
    status: shared === 'shared' ? 'shared' : shared === 'cancelled' ? 'cancelled' : 'failed',
  };
}

export function runExport(
  download: () => Promise<ExportResult> = () => downloadExport(),
  saveDeps: () => SaveDeps = realSaveDeps,
): Promise<ExportFlowResult> {
  return exportMyData({
    download,
    // The share sheet (Android: Files/Drive/...; iOS: Save to Files). No `media_saved` event: that one is for results.
    share: async (file) => {
      try {
        await saveDeps().share(file, 'application/zip');
        return 'shared';
      } catch (e) {
        return /cancel|dismiss/i.test(e instanceof Error ? e.message : String(e ?? ''))
          ? 'cancelled'
          : 'failed';
      }
    },
  });
}
