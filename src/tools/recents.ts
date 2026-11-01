import { TOOL_BY_ID } from './registry';
import type { AnyToolDefinition } from './types';

/** Reads settings.lastToolIds, dropping ids no longer in the registry. */
export function recentTools(ids: readonly string[]): AnyToolDefinition[] {
  const out: AnyToolDefinition[] = [];
  for (const id of ids) {
    const t = TOOL_BY_ID.get(id);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
