import type { HistoryEntry } from '@/api/schemas/history';
import { getTool } from '@/tools/registry';

/**
 * API `tool` string (`conversionToolFor`, internal/handlers/job_record.go; `ai_` + the AI operation from
 * internal/services/ai_tools.go; the web `account.history.tool` map) -> registry tool id.
 * `ai_upscale` is `ai_` + the operation `ai_upscale`, hence the doubled prefix.
 */
export const TOOL_ID_BY_API_TOOL: Readonly<Record<string, string>> = {
  transcribe: 'transcribe',
  audio_waveform: 'audio-waveform',
  extract_audio: 'video-extract-audio',
  extract_video_only: 'video-remove-audio',
  extract_frames: 'video-extract-frames',
  trim_video: 'video-trim',
  ai_remove_background: 'remove-background',
  ai_background_removal: 'remove-background',
  ai_ai_upscale: 'upscale',
  ai_upscale: 'upscale',
  ai_face_privacy: 'blur-faces',
  ai_redact_text: 'redact-text',
  ai_text_redaction: 'redact-text',
  ai_remove_object: 'remove-object',
  ai_object_removal: 'remove-object',
  ai_clean_voice: 'clean-voice',
  ai_voice_cleanup: 'clean-voice',
  ai_remove_background_noise: 'remove-noise',
  ai_isolate_vocals: 'isolate-vocals',
  ai_remove_vocals: 'remove-vocals',
  ai_frame_interpolation: 'frame-interpolation',
};

const CONVERT_BY_KIND: Readonly<Record<string, string>> = {
  image: 'image-convert',
  video: 'video-convert',
  audio: 'audio-convert',
};

/** API tools with no app tool: labelled by `history.tool.<apiTool>`. */
export const FALLBACK_LABEL_TOOLS = [
  'convert',
  'caption_translator',
  'stitch_audio_to_video',
  'video_transcode',
  'document_scan',
  'image_restore',
  'video_restore',
  'studio_derive',
  'studio_captions',
  'studio_export',
  'video_summary',
  'vector_vectorize',
  'studio_reverse_proxy',
] as const;

export interface ToolLabel {
  /** Registry tool when one matches (icon, `titleKey`). */
  toolId?: string;
  /** i18n key of the label (registry `titleKey` or `history.tool.*`); absent for the prettified text. */
  key?: string;
  /** Prettified id when no key exists. */
  text?: string;
}

/** Web `prettifyToolId`: "ai_text_thing" -> "Text thing". */
export function prettifyToolId(id: string): string {
  const words = id
    .replace(/^ai_/, '')
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/** The id the row is labelled by (web `toolIdOf`). */
export function apiToolOf(entry: Pick<HistoryEntry, 'tool' | 'mode'>): string {
  return entry.tool || entry.mode || 'convert';
}

export function toolLabel(entry: Pick<HistoryEntry, 'tool' | 'mode' | 'mediaKind'>): ToolLabel {
  const api = apiToolOf(entry);
  let toolId = TOOL_ID_BY_API_TOOL[api];
  if (!toolId && api === 'convert') toolId = CONVERT_BY_KIND[entry.mediaKind ?? ''];
  const tool = toolId ? getTool(toolId) : undefined;
  if (tool) return { toolId: tool.id, key: tool.titleKey };
  if ((FALLBACK_LABEL_TOOLS as readonly string[]).includes(api)) {
    return { key: `history.tool.${api}` };
  }
  return { text: prettifyToolId(api) };
}
