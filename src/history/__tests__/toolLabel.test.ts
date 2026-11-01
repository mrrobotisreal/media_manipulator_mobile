import { getTool } from '@/tools/registry';
import { FALLBACK_LABEL_TOOLS, TOOL_ID_BY_API_TOOL, prettifyToolId, toolLabel } from '../toolLabel';
import en from '../../../locales/en-us/app.json';

/** Every `tool` string the API can emit: `conversionToolFor` modes + `ai_<AI operation>` + the web label map. */
const API_TOOLS = [
  'convert',
  'transcribe',
  'audio_waveform',
  'extract_audio',
  'extract_video_only',
  'extract_frames',
  'trim_video',
  'ai_remove_background',
  'ai_ai_upscale',
  'ai_face_privacy',
  'ai_redact_text',
  'ai_remove_object',
  'ai_clean_voice',
  'ai_remove_background_noise',
  'ai_isolate_vocals',
  'ai_remove_vocals',
  'ai_frame_interpolation',
  // web `account.history.tool` keys
  'caption_translator',
  'stitch_audio_to_video',
  'video_transcode',
  'document_scan',
  'image_restore',
  'video_restore',
  'studio_derive',
  'studio_captions',
  'studio_export',
  'ai_upscale',
  'ai_background_removal',
  'ai_text_redaction',
  'ai_object_removal',
  'ai_voice_cleanup',
  'video_summary',
];

describe('toolLabel', () => {
  it.each(API_TOOLS)('%s maps to a registry tool, an app key, or a prettified fallback', (tool) => {
    const l = toolLabel({ tool, mediaKind: 'image' });
    expect(l.toolId || l.key || l.text).toBeTruthy();
    if (l.toolId) expect(getTool(l.toolId)).toBeDefined();
    if (l.key?.startsWith('history.tool.')) {
      const k = l.key.slice('history.tool.'.length);
      expect((en.history.tool as Record<string, string>)[k]).toBeTruthy();
    }
  });

  it('every mapped registry id exists and every fallback tool has an English label', () => {
    for (const id of Object.values(TOOL_ID_BY_API_TOOL)) expect(getTool(id)).toBeDefined();
    for (const t of FALLBACK_LABEL_TOOLS)
      expect((en.history.tool as Record<string, string>)[t]).toBeTruthy();
  });

  it('convert resolves by media kind', () => {
    expect(toolLabel({ tool: 'convert', mediaKind: 'video' }).toolId).toBe('video-convert');
    expect(toolLabel({ tool: 'convert', mediaKind: 'audio' }).toolId).toBe('audio-convert');
    expect(toolLabel({ tool: 'convert', mediaKind: 'image' }).toolId).toBe('image-convert');
    expect(toolLabel({ tool: 'convert', mediaKind: 'document' }).key).toBe('history.tool.convert');
    expect(toolLabel({ mediaKind: 'image' }).toolId).toBe('image-convert');
  });

  it('known examples', () => {
    expect(toolLabel({ tool: 'ai_remove_background' }).toolId).toBe('remove-background');
    expect(toolLabel({ tool: 'ai_ai_upscale' }).toolId).toBe('upscale');
    expect(toolLabel({ tool: 'extract_frames' }).toolId).toBe('video-extract-frames');
  });

  it('prettifies an unknown tool', () => {
    expect(toolLabel({ tool: 'ai_fancy_new_thing' }).text).toBe('Fancy new thing');
    expect(prettifyToolId('vector_export')).toBe('Vector export');
  });
});
