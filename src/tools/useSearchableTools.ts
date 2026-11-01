import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TOOLS } from './registry';
import type { SearchableTool } from './search';

/** Tools with their active-locale and English strings, for search. */
export function useSearchableTools(): SearchableTool[] {
  const { t, i18n } = useTranslation();
  return useMemo(
    () =>
      TOOLS.map((tool) => ({
        tool,
        title: t(tool.titleKey),
        description: t(tool.descriptionKey),
        englishTitle: t(tool.titleKey, { lng: 'en-US' }),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  );
}
