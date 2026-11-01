import { aiTools } from './families/ai';
import { audioTools } from './families/audio';
import { imageTools } from './families/image';
import { metadataTools } from './families/metadata';
import { videoTools } from './families/video';
import type { AnyToolDefinition, MediaKind, ToolFamily } from './types';

export * from './types';

export const TOOLS: readonly AnyToolDefinition[] = [
  ...imageTools,
  ...videoTools,
  ...audioTools,
  ...aiTools,
  ...metadataTools,
];

export const TOOL_BY_ID: ReadonlyMap<string, AnyToolDefinition> = new Map(
  TOOLS.map((t) => [t.id, t]),
);

export function getTool(id: string): AnyToolDefinition | undefined {
  return TOOL_BY_ID.get(id);
}

export function toolsByFamily(family: ToolFamily): AnyToolDefinition[] {
  return TOOLS.filter((t) => t.family === family);
}

export function toolsAccepting(kind: MediaKind): AnyToolDefinition[] {
  return TOOLS.filter((t) => t.accepts.kinds.includes(kind));
}

/** Catalog media_kind for analytics context: first accepted kind; pdf -> document. */
export function analyticsMediaKind(
  tool: AnyToolDefinition,
): 'image' | 'video' | 'audio' | 'document' | 'unknown' {
  const k = tool.accepts.kinds[0];
  if (!k) return 'unknown';
  return k === 'pdf' ? 'document' : k;
}
