import { z } from 'zod';

export const KNOWN_TIERS = ['anonymous', 'free', 'premium', 'pro', 'operator'] as const;
export type KnownTier = (typeof KNOWN_TIERS)[number];

/** Permissive: any string parses so a new server tier never breaks a response. */
export const tierSchema = z.string();

/** Normalises a server tier to the known set; `free` is the display fallback. */
export function tierOf(x: unknown): KnownTier {
  return (KNOWN_TIERS as readonly string[]).includes(x as string) ? (x as KnownTier) : 'free';
}
