import * as Localization from 'expo-localization';
import { useAppSelector } from '@/state/hooks';
import { resolveLocale } from './resolveLocale';

/** The locale code the UI resolves to (override, else best device match, else en-US). */
export function useActiveLocale(): string {
  const override = useAppSelector((s) => s.settings.locale);
  return resolveLocale(override, Localization.getLocales());
}
