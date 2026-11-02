import { renderTranscript, transcriptCues, type TranscriptFormat } from './transcriptFormats';
import { formatCaptions, parseCaptions, type Cue } from './captions';
import type { TranscribeResult } from '@/api/schemas/transcript';

/** Web `MAX_CAPTION_BYTES`: a caption file over 5 MB is not parsed on the phone. */
export const MAX_CAPTION_BYTES = 5 * 1024 * 1024;

export const EXPORT_FORMATS: readonly TranscriptFormat[] = ['srt', 'vtt', 'txt', 'json'];

export const EXPORT_MIME: Record<TranscriptFormat, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  txt: 'text/plain',
  json: 'application/json',
};

/** Cues whose text contains `query` (case-insensitive, locale-aware lower-casing); empty query keeps all. */
export function filterCues(cues: readonly Cue[], query: string): Cue[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...cues];
  return cues.filter((c) => c.text.toLocaleLowerCase().includes(q));
}

/** What the viewer needs from either source: cues for the list and a way to render any export format. */
export interface TranscriptSource {
  cues: Cue[];
  language?: string;
  durationSeconds?: number;
  render(format: TranscriptFormat): string;
}

export function sourceFromTranscript(result: TranscribeResult): TranscriptSource {
  return {
    cues: transcriptCues(result),
    language: result.language,
    durationSeconds: result.durationSeconds,
    render: (format) => renderTranscript(result, format),
  };
}

/** A parsed `.srt`/`.vtt`: txt is the cue text, json the cue list (no language known). */
export function sourceFromCues(cues: Cue[]): TranscriptSource {
  const last = cues[cues.length - 1];
  return {
    cues,
    durationSeconds: last ? last.endMs / 1000 : undefined,
    render: (format) => {
      switch (format) {
        case 'srt':
        case 'vtt':
          return formatCaptions(cues, format);
        case 'txt':
          return cues.map((c) => c.text.trim()).join('\n');
        case 'json':
          return JSON.stringify(
            {
              segments: cues.map((c, i) => ({
                id: i,
                start: c.startMs / 1000,
                end: c.endMs / 1000,
                text: c.text,
              })),
            },
            null,
            2,
          );
      }
    },
  };
}

/** `talk_transcript.vtt` + `srt` -> `talk_transcript.srt`; names without a dot just gain the extension. */
export function exportFileName(resultFileName: string, format: TranscriptFormat): string {
  const base = resultFileName.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'transcript';
  return `${base}.${format}`;
}

/** The plain text "Copy all" puts on the clipboard. */
export function copyText(source: TranscriptSource): string {
  return source.render('txt');
}

/** Downloaded `.srt`/`.vtt` text -> the shared list/export model (never throws; bad blocks are skipped). */
export function captionSource(text: string, hint?: 'srt' | 'vtt'): TranscriptSource {
  return sourceFromCues(parseCaptions(text, hint).cues);
}
