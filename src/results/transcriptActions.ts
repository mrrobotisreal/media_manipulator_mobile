import { track } from '@/analytics/track';
import type { TranscriptFormat } from './transcriptFormats';
import { EXPORT_MIME, exportFileName, copyText, type TranscriptSource } from './transcriptModel';

export interface TranscriptActionDeps {
  copy(text: string): Promise<void>;
  /** Writes `content` to a cache file named `fileName` and opens the share sheet. */
  shareText(fileName: string, mime: string, content: string, jobId: string): Promise<void>;
}

/** Catalog: `feature_used {feature:'transcript', action:'copy'|'export', value: format}` (no text, no names). */
export async function copyTranscript(
  source: TranscriptSource,
  deps: Pick<TranscriptActionDeps, 'copy'>,
): Promise<void> {
  await deps.copy(copyText(source));
  track('feature_used', { feature: 'transcript', action: 'copy', value: 'txt' });
}

export async function exportTranscript(
  source: TranscriptSource,
  format: TranscriptFormat,
  resultFileName: string,
  jobId: string,
  deps: Pick<TranscriptActionDeps, 'shareText'>,
): Promise<void> {
  // Built once, from the same cues the list shows.
  const content = source.render(format);
  await deps.shareText(exportFileName(resultFileName, format), EXPORT_MIME[format], content, jobId);
  track('feature_used', { feature: 'transcript', action: 'export', value: format });
}

/** Real bindings, required lazily so tests and the registry never load the native modules. */
export function realTranscriptDeps(): TranscriptActionDeps {
  return {
    copy: async (text) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      await Clipboard.setStringAsync(text);
    },
    shareText: async (fileName, mime, content, jobId) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('expo-file-system') as typeof import('expo-file-system');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      const dir = new fs.Directory(fs.Paths.cache, 'exports', jobId.replace(/[^A-Za-z0-9_-]/g, '_'));
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const file = new fs.File(dir, fileName);
      if (file.exists) file.delete();
      file.create();
      file.write(content);
      await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: fileName });
    },
  };
}
