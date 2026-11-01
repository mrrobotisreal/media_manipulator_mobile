import { clearContext, setContext, track } from './track';

/** App values for `tool_viewed.entry_point` (passed as the route param `from`). */
export type ToolEntryPoint = 'tools_tab' | 'search' | 'recents' | 'intake' | 'deep_link' | 'other';

const ENTRY_POINTS: readonly string[] = [
  'tools_tab',
  'search',
  'recents',
  'intake',
  'deep_link',
  'other',
];

export function parseEntryPoint(raw: string | undefined): ToolEntryPoint {
  return raw && ENTRY_POINTS.includes(raw) ? (raw as ToolEntryPoint) : 'deep_link';
}

export const TOOL_CONTEXT_KEYS = ['tool_slug', 'media_kind'];

/** Sets the tool context and fires `tool_viewed`; returns the cleanup that clears the context. */
export function trackToolViewed(
  tool: { analyticsSlug: string },
  mediaKind: string,
  entryPoint: ToolEntryPoint,
): () => void {
  setContext({ tool_slug: tool.analyticsSlug, media_kind: mediaKind });
  track('tool_viewed', { entry_point: entryPoint });
  return () => clearContext(TOOL_CONTEXT_KEYS);
}
