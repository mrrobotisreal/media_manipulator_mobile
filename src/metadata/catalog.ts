// Ported from media-manipulator-ui lib/metadata/catalog.ts @ f67c959 (web main). Keep in step with the web file.
import { z } from 'zod';
import { aboutKey } from './keys';

/**
 * Tag classification catalog loader.
 *
 * `lib/metadata/catalog.json` is a GENERATED COPY of the API's
 * `media_manipulator_api/internal/metadata/catalog.json` (itself generated from
 * docs/design/research/METADATA_TAG_CATALOG.md). Do not hand-edit it; re-copy it
 * whenever the API file changes (automated in MM12) and re-run
 * `node scripts/gen-metadata-i18n.mjs` so the English description shard follows.
 * JSON cannot carry a header comment, hence this note.
 *
 * APP DEVIATION (MA21 decision 3): the 410 KB catalog.json and the lazy `getCatalog` loader are
 * NOT shipped; `rows.ts` is called with a stub index (`buildCatalogIndex(EMPTY_CATALOG)`).
 */

export const catalogTagSchema = z.object({
  group: z.string().optional(),
  tag: z.string(),
  aliases: z.array(z.string()),
  description: z.string(),
  privacy: z.string(),
  category: z.string(),
  unverified: z.boolean(),
});
export type CatalogTag = z.infer<typeof catalogTagSchema>;

export const catalogSchema = z.object({
  schemaVersion: z.number(),
  categories: z.array(z.object({ id: z.string(), titleKey: z.string() })),
  tags: z.array(catalogTagSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

export interface CatalogIndex {
  catalog: Catalog;
  byGroupTag: Map<string, CatalogTag[]>;
  byTag: Map<string, CatalogTag[]>;
  byAlias: Map<string, CatalogTag[]>;
  wildcards: CatalogTag[];
  categories: Map<string, { id: string; titleKey: string }>;
}

/** Same shape the API uses to decide an alias is itself a tag name. */
const ALIAS_TAG_RE = /^[A-Z][A-Za-z0-9]+$/;

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function buildCatalogIndex(input: unknown): CatalogIndex {
  const catalog = catalogSchema.parse(input);
  const index: CatalogIndex = {
    catalog,
    byGroupTag: new Map(),
    byTag: new Map(),
    byAlias: new Map(),
    wildcards: [],
    categories: new Map(catalog.categories.map((c) => [c.id, c])),
  };
  for (const row of catalog.tags) {
    const tag = row.tag.toLowerCase();
    if (tag.endsWith('*')) {
      index.wildcards.push(row);
      continue;
    }
    if (row.group) {
      push(index.byGroupTag, `${row.group.toLowerCase()}\0${tag}`, row);
      continue;
    }
    push(index.byTag, tag, row);
    for (const alias of row.aliases) {
      if (ALIAS_TAG_RE.test(alias)) push(index.byAlias, alias.toLowerCase(), row);
    }
  }
  return index;
}

const pick = (rows: CatalogTag[] | undefined, category?: string): CatalogTag | undefined => {
  if (!rows?.length) return undefined;
  return (category && rows.find((r) => r.category === category)) || rows[0];
};

/**
 * Finds the catalog row for an entry: exact `group:tag`, then tag-only, then an
 * alias that is itself a tag name, then trailing-`*` wildcard rows (a bare `*` only
 * within its own group). `category`
 * (the server-assigned one) disambiguates tags the catalog documents once per
 * category. Unknown tags return `undefined`; the UI then shows the raw name and
 * `metadata:about.unknown`.
 */
export function lookupTag(
  index: CatalogIndex,
  group: string,
  tag: string,
  category?: string,
): CatalogTag | undefined {
  const t = tag.toLowerCase();
  const exact = pick(index.byGroupTag.get(`${group.toLowerCase()}\0${t}`), category);
  if (exact) return exact;
  const byTag = pick(index.byTag.get(t), category);
  if (byTag) return byTag;
  const alias = pick(index.byAlias.get(t), category);
  if (alias) return alias;
  const g = group.toLowerCase();
  for (const row of index.wildcards) {
    // Group-scoped wildcards (XMP-xmpDM:*) only match their own group.
    if (row.group && row.group.toLowerCase() !== g) continue;
    if (t.startsWith(row.tag.toLowerCase().slice(0, -1))) return row;
  }
  return undefined;
}

export function categoryMeta(index: CatalogIndex, id: string) {
  return index.categories.get(id);
}

/** i18n key (under `metadata:`) of a catalog row's description. */
export function descriptionKey(row: CatalogTag): string {
  return aboutKey(row);
}

/** Stub catalog: no tag descriptions in v1, so every row's `about` is undefined. */
export const EMPTY_CATALOG = { schemaVersion: 1, categories: [], tags: [] };
