import { useTranslation } from 'react-i18next';
import type { Chip } from '@/ui/components/ChipRow';

/**
 * Container chips for tools that offer "Same as original": the first chip keeps the input container
 * when the API can write it (decision 4), else MP4; the label names what it will become.
 */
export function useFormatChips<T extends string>(
  allowed: readonly T[],
  extension: string | undefined,
  withSame: boolean,
): Chip<T | 'same'>[] {
  const { t } = useTranslation();
  const ext = extension?.toLowerCase();
  const resolved = (allowed as readonly string[]).includes(ext ?? '') ? ext! : 'mp4';
  const chips: Chip<T | 'same'>[] = allowed.map((f) => ({ value: f, label: f.toUpperCase() }));
  if (!withSame) return chips;
  return [
    { value: 'same', label: t('tools.video.sameAsOriginal', { format: resolved.toUpperCase() }) },
    ...chips,
  ];
}

/** `options_changed` helper: which top-level keys differ between two form values. */
export function changedKeys(prev: object, next: object): string[] {
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
