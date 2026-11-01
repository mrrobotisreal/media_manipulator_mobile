import { TOOL_FAMILIES, type AnyToolDefinition, type ToolFamily } from './types';

export const fold = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export interface SearchableTool {
  tool: AnyToolDefinition;
  /** Active-locale title and description. */
  title: string;
  description: string;
  /** English title (always searchable). */
  englishTitle: string;
}

/** Case- and diacritic-insensitive match over the locale title/description, English title and keywords. */
export function matchesQuery(item: SearchableTool, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(
    [
      item.title,
      item.description,
      item.englishTitle,
      item.tool.id.replace(/-/g, ' '),
      ...item.tool.keywords,
    ].join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

export interface ToolSection {
  family: ToolFamily;
  data: SearchableTool[];
}

/** Results keep family grouping; empty families are dropped. */
export function searchTools(items: SearchableTool[], query: string): ToolSection[] {
  return TOOL_FAMILIES.map((family) => ({
    family,
    data: items.filter((i) => i.tool.family === family && matchesQuery(i, query)),
  })).filter((s) => s.data.length > 0);
}
