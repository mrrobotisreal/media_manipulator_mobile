import { recentTools } from '@/tools/recents';
import { TOOLS } from '@/tools/registry';
import type { AnyToolDefinition, MediaKind } from '@/tools/types';

/** MA52 Aperture entry rows (`aperture-*`): offered after every other tool on the intake screen. */
const isApertureEntry = (t: AnyToolDefinition) => t.id.startsWith('aperture-');

/**
 * Tools that accept every one of the given kinds: recents first, then Aperture (MA52, photos), then
 * registry (family) order, then Aperture's entry rows (so the sixteen of them never push the AI and
 * metadata tools off the screen).
 */
export function toolsForKinds(
  kinds: readonly MediaKind[],
  lastToolIds: readonly string[],
): AnyToolDefinition[] {
  if (kinds.length === 0) return [];
  const unique = [...new Set(kinds)];
  const ok = (t: AnyToolDefinition) => unique.every((k) => t.accepts.kinds.includes(k));
  const recents = recentTools(lastToolIds).filter(ok);
  const rest = TOOLS.filter((t) => ok(t) && !recents.includes(t));
  const aperture = rest.filter((t) => t.id === 'aperture');
  return [
    ...recents,
    ...aperture,
    ...rest.filter((t) => t.id !== 'aperture' && !isApertureEntry(t)),
    ...rest.filter(isApertureEntry),
  ];
}
