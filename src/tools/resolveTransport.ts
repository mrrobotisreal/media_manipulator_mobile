import type { MediaKind, ResolvedTransport, ToolDefinition } from './types';

/**
 * Which API path a tool uses for a given file. 'auto' tools (isolate-vocals, remove-vocals,
 * transcribe) presign video files and multipart-upload everything else (TOOLS_V1 §2, U/P rows).
 */
export function resolveTransport(
  tool: Pick<ToolDefinition, 'endpoint'>,
  mediaKind: MediaKind,
): ResolvedTransport {
  if (tool.endpoint === 'auto') return mediaKind === 'video' ? 'presign' : 'upload';
  return tool.endpoint;
}
