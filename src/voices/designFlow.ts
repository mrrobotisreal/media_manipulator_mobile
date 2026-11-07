import {
  VOICE_DESCRIPTION_MAX_CHARS,
  VOICE_DESIGN_PREVIEWS_PER_DESCRIPTION,
} from '@/tools/voices/consent';

/** The web `DESIGN_CHIPS` (components/voices/voice-designer.tsx): the visible label is translated, the trait is English. */
export const DESIGN_CHIPS = {
  gender: { female: 'female', male: 'male', neutral: 'androgynous' },
  age: { young: 'young adult', middleAged: 'middle-aged', older: 'older' },
  accent: {
    american: 'American accent',
    british: 'British accent',
    australian: 'Australian accent',
    irish: 'Irish accent',
  },
  tone: {
    warm: 'warm',
    bright: 'bright',
    deep: 'deep',
    raspy: 'slightly raspy',
    soft: 'soft-spoken',
  },
  pace: { slow: 'slow pace', measured: 'measured pace', fast: 'fast pace' },
} as const;
export type ChipGroup = keyof typeof DESIGN_CHIPS;
export const CHIP_GROUPS: readonly ChipGroup[] = ['gender', 'age', 'accent', 'tone', 'pace'];

/** Appends a trait to a description, comma-separated, once (web `appendTrait`). */
export function appendTrait(description: string, trait: string): string {
  const d = description.trim().replace(/[,\s]+$/, '');
  if (!d) return trait;
  if (d.toLowerCase().split(/,\s*/).includes(trait.toLowerCase())) return d;
  return `${d}, ${trait}`;
}

export const descriptionOk = (d: string): boolean => {
  const n = [...d.trim()].length;
  return n >= 1 && n <= VOICE_DESCRIPTION_MAX_CHARS;
};

/**
 * Previews left for one description, counted on this device (the server's real limit is 3 per
 * description per hour; a `preview_limit` answer is authoritative). Keyed by description + language.
 */
export function previewsLeft(used: number): number {
  return Math.max(0, VOICE_DESIGN_PREVIEWS_PER_DESCRIPTION - used);
}
