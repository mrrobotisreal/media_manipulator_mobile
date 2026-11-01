import { recentTools } from '@/tools/recents';
import { TOOLS } from '@/tools/registry';
import type { AnyToolDefinition, MediaKind } from '@/tools/types';

/** Tools that accept every one of the given kinds: recents first, then registry (family) order. */
export function toolsForKinds(
  kinds: readonly MediaKind[],
  lastToolIds: readonly string[],
): AnyToolDefinition[] {
  if (kinds.length === 0) return [];
  const unique = [...new Set(kinds)];
  const ok = (t: AnyToolDefinition) => unique.every((k) => t.accepts.kinds.includes(k));
  const recents = recentTools(lastToolIds).filter(ok);
  return [...recents, ...TOOLS.filter((t) => ok(t) && !recents.includes(t))];
}
