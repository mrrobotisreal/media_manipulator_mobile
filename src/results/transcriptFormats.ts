/** Port of media-manipulator-ui `lib/results/transcriptFormats.ts` (web main, 2026-11-02); only the TranscribeResult import differs. */
import type { TranscribeResult } from '@/api/schemas/transcript';
import { formatCaptions, type Cue } from './captions';

export type TranscriptFormat = 'vtt' | 'srt' | 'txt' | 'json';

type RenderableTranscript = Pick<TranscribeResult, 'language' | 'durationSeconds' | 'segments' | 'transcriptText'>;

/** Segments (seconds) as cues (ms). Without segments the whole text is one cue. */
export function transcriptCues(result: RenderableTranscript): Cue[] {
  if (result.segments && result.segments.length > 0) {
    return result.segments.map((s, i) => ({
      index: i + 1,
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    }));
  }
  const text = (result.transcriptText ?? '').trim();
  if (!text) return [];
  return [{ index: 1, startMs: 0, endMs: Math.round((result.durationSeconds ?? 0) * 1000), text }];
}

/** Builds the vtt/srt/txt/json body client-side from the `/transcript/:id` payload. */
export function renderTranscript(result: RenderableTranscript, format: TranscriptFormat): string {
  switch (format) {
    case 'vtt':
    case 'srt':
      return formatCaptions(transcriptCues(result), format);
    case 'txt':
      if (result.segments && result.segments.length > 0) {
        return result.segments.map((s) => s.text.trim()).join('\n');
      }
      return result.transcriptText ?? '';
    case 'json':
      return JSON.stringify(
        { language: result.language, durationSeconds: result.durationSeconds, segments: result.segments ?? [] },
        null,
        2,
      );
  }
}
