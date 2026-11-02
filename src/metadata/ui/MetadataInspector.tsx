import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { formatBytes } from '@/lib/format';
import { showNotice } from '@/ui/notice';
import { MultiChips } from '@/ui/components/Chips';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';
import {
  trackMetadataInspected,
  trackPrivacyFilter,
  trackSearchUsed,
  trackSectionToggled,
  type MetadataSurface,
} from '../analytics';
import { EMPTY_CATALOG, buildCatalogIndex } from '../catalog';
import {
  PRIVACY_CHIP_ORDER,
  countByPrivacy,
  defaultOpen,
  groupByCategory,
  hasOnlyBasicInfo,
} from '../categories';
import { extractCoordinates, formatCoordinates } from '../format';
import { buildRows, type MetadataRow } from '../rows';
import { buildSearchIndex, searchEntries } from '../search';
import { privacyOf, type MetadataDocument, type PrivacyClass } from '../types';

const CATALOG = buildCatalogIndex(EMPTY_CATALOG);
const SEARCH_DEBOUNCE_MS = 300;

export function mapsUrl(lat: number, lon: number, platform: string = Platform.OS): string {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  return platform === 'ios' ? `maps://?ll=${la},${lo}` : `geo:${la},${lo}?q=${la},${lo}`;
}

/** Plain-text export for "Copy all as text": the raw `group:tag = value` lines. */
export function documentAsText(rows: readonly MetadataRow[]): string {
  return rows.map((r) => `${r.entry.group}:${r.entry.tag} = ${r.text}`).join('\n');
}

function CoordinateCard({ document: doc }: { document: MetadataDocument }) {
  const { t } = useTranslation();
  const coords = extractCoordinates(doc.entries);
  if (!coords) return null;
  const { decimal, dms } = formatCoordinates(coords.lat, coords.lon);
  const alt = doc.entries.find(
    (e) => e.tag === 'GPSAltitude' && (e.group === 'GPS' || e.group === 'Composite'),
  );
  const altitude =
    alt && alt.value !== null && typeof alt.value !== 'object' ? String(alt.value) : undefined;
  // Nothing contacts a map service until this is tapped.
  const open = () => void Linking.openURL(mapsUrl(coords.lat, coords.lon)).catch(() => undefined);
  return (
    <View
      className="gap-2 rounded-lg border border-edge bg-surface-1 p-3"
      testID="metadata-gps-card"
    >
      <View className="flex-row items-center gap-2">
        <Text className="font-semibold">{t('tools.metadata.gps.title')}</Text>
      </View>
      <View className="gap-1">
        <Text className="text-sm text-muted-fg">{t('tools.metadata.gps.decimal')}</Text>
        <Num selectable testID="gps-decimal">
          {decimal}
        </Num>
        <Text className="text-sm text-muted-fg">{t('tools.metadata.gps.dms')}</Text>
        <Num selectable testID="gps-dms">
          {dms}
        </Num>
        {altitude ? (
          <>
            <Text className="text-sm text-muted-fg">{t('tools.metadata.gps.altitude')}</Text>
            <Num>{altitude}</Num>
          </>
        ) : null}
      </View>
      <Text className="text-xs text-subtle">{t('tools.metadata.gps.privacy')}</Text>
      <Button
        label={t('tools.metadata.gps.openMaps')}
        variant="secondary"
        onPress={open}
        testID="gps-open-maps"
      />
    </View>
  );
}

function RowView({ row, onCopy }: { row: MetadataRow; onCopy: (r: MetadataRow) => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const f = row.formatted;
  const text =
    f.kind === 'binary'
      ? f.bytes === undefined
        ? t('tools.metadata.binaryNoSize')
        : t('tools.metadata.binary', { size: formatBytes(f.bytes) })
      : f.kind === 'chips'
        ? f.items.join(' · ') + (f.more > 0 ? ` +${f.more}` : '')
        : f.kind === 'object'
          ? row.text
          : f.text;
  const long = text.length > 140 || text.includes('\n');
  return (
    <Pressable
      onLongPress={() => onCopy(row)}
      accessibilityHint={t('tools.metadata.copyAll')}
      className="gap-0.5 border-b border-edge py-2"
      testID={`metadata-row-${row.entry.id}`}
    >
      <Text className="text-sm text-muted-fg">{row.label}</Text>
      {/* Values (coordinates, numbers, hashes) stay LTR and mono. */}
      <Num
        numberOfLines={expanded ? undefined : 3}
        style={{ writingDirection: 'ltr', textAlign: 'auto' }}
      >
        {text}
      </Num>
      {long ? (
        <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button">
          <Text className="text-sm text-primary">
            {expanded ? t('tools.metadata.showLess') : t('tools.metadata.showMore')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * Native metadata inspector (MA21 decision 5): summary, privacy chips, search, collapsible
 * category sections, GPS card (no map tile, no network). Rendered inline in the parent scroll view.
 */
export function MetadataInspector({
  document: doc,
  surface,
}: {
  document: MetadataDocument;
  surface: MetadataSurface;
}) {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<PrivacyClass[]>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const searched = useRef(false);
  const rows = useMemo(
    () =>
      buildRows(doc.entries, {
        catalog: CATALOG,
        describe: (r) => r.description,
        locale: i18n.language,
      }),
    [doc.entries, i18n.language],
  );
  const rowById = useMemo(() => new Map(rows.map((r) => [r.entry.id, r])), [rows]);
  const index = useMemo(
    () => buildSearchIndex(doc.entries, { locale: i18n.language }),
    [doc.entries, i18n.language],
  );
  const groups = useMemo(() => groupByCategory(doc.entries), [doc.entries]);
  const counts = useMemo(() => countByPrivacy(doc.entries), [doc.entries]);
  const initialOpen = useMemo(
    () => new Set(defaultOpen(new Set(groups.map((g) => g.id)))),
    [groups],
  );
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    trackMetadataInspected(doc, surface);
  }, [doc, surface]);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query]);
  useEffect(() => {
    if (debounced.trim() && !searched.current) {
      searched.current = true;
      trackSearchUsed();
    }
  }, [debounced]);

  const matches = useMemo(() => searchEntries(index, debounced), [index, debounced]);
  const filtering = matches !== null || filters.length > 0;
  const sections = useMemo(
    () =>
      groups
        .map((g) => ({
          id: g.id,
          privacy: g.privacy,
          rows: g.entries
            .filter((e) => {
              if (matches && !matches.has(e.id)) return false;
              if (filters.length) {
                const p = privacyOf(e);
                if (!p || !filters.includes(p)) return false;
              }
              return true;
            })
            .map((e) => rowById.get(e.id))
            .filter((r): r is MetadataRow => r !== undefined),
        }))
        .filter((s) => !filtering || s.rows.length > 0),
    [groups, matches, filters, rowById, filtering],
  );

  const isOpen = (id: string) =>
    filtering ? toggled[id] !== false : (toggled[id] ?? initialOpen.has(id));
  const toggle = (id: string) => {
    const next = !isOpen(id);
    setToggled((s) => ({ ...s, [id]: next }));
    trackSectionToggled(id, next);
  };
  const toggleFilter = (p: PrivacyClass) => {
    const active = !filters.includes(p);
    setFilters(active ? [...filters, p] : filters.filter((x) => x !== p));
    if (active) trackPrivacyFilter(p);
    setToggled({});
  };
  const copy = async (text: string) => {
    try {
      // Lazy: keeps the native module out of every test that only loads the registry.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      await Clipboard.setStringAsync(text);
      showNotice(t('tools.metadata.copied'));
    } catch {
      // Clipboard unavailable: nothing to report.
    }
  };

  const kindKey = ['image', 'video', 'audio', 'document'].includes(doc.file.kind)
    ? doc.file.kind
    : 'unknown';
  const dims = doc.entries.find((e) => e.id === 'Composite:ImageSize');
  const dur = rows.find(
    (r) => r.entry.tag === 'Duration' || (r.entry.group === 'Format' && r.entry.tag === 'duration'),
  );
  const basic = hasOnlyBasicInfo(doc.entries);
  const privacyLabel = (p: PrivacyClass) => t(`tools.metadata.privacy.${p}`);

  return (
    <View className="gap-3" testID="metadata-inspector">
      <View
        className="gap-1 rounded-lg border border-edge bg-surface-1 p-3"
        testID="metadata-summary"
      >
        <Text className="font-semibold">{t(`tools.metadata.kind.${kindKey}`)}</Text>
        <Num className="text-sm text-muted-fg">
          {t('tools.metadata.summary.tagCount', {
            count: doc.entries.length,
            categories: groups.length,
          })}
        </Num>
        {dims && typeof dims.value === 'string' ? (
          <Num className="text-sm text-muted-fg">
            {t('tools.metadata.summary.dimensions')}: {dims.value}
          </Num>
        ) : null}
        {dur ? (
          <Num className="text-sm text-muted-fg">
            {t('tools.metadata.summary.duration')}: {dur.text}
          </Num>
        ) : null}
      </View>

      {doc.warnings.length > 0 ? (
        <View
          className="rounded-lg border border-edge-strong bg-surface-2 p-3"
          testID="metadata-warnings"
        >
          <Text className="font-semibold">{t('tools.metadata.warnings.title')}</Text>
        </View>
      ) : null}

      <CoordinateCard document={doc} />

      {basic ? (
        <View
          className="gap-1 rounded-lg border border-edge bg-surface-1 p-3"
          testID="metadata-empty"
        >
          <Text className="font-semibold">{t('tools.metadata.empty.title')}</Text>
          <Text className="text-sm text-muted-fg">{t('tools.metadata.empty.body')}</Text>
        </View>
      ) : null}

      <View className="gap-2" testID="metadata-privacy-chips">
        <Text className="text-sm text-muted-fg">{t('tools.metadata.privacy.label')}</Text>
        <MultiChips<PrivacyClass>
          options={PRIVACY_CHIP_ORDER.filter((p) => counts[p] > 0).map((p) => ({
            value: p,
            label: `${privacyLabel(p)} (${counts[p]})`,
          }))}
          value={filters}
          onToggle={toggleFilter}
          label={t('tools.metadata.privacy.label')}
        />
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('tools.metadata.search.placeholder')}
        accessibilityLabel={t('tools.metadata.search.placeholder')}
        placeholderTextColor={colors.subtle}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        className="rounded-md border border-edge-control bg-surface-1 px-3 font-sans text-foreground"
        style={{ minHeight: hitTarget, textAlign: 'auto' }}
        testID="metadata-search"
      />

      {filtering && sections.length === 0 ? (
        <Text className="text-muted-fg" testID="metadata-no-results">
          {t('tools.metadata.search.noResults')}
        </Text>
      ) : null}

      {sections.map((s) => {
        const open = isOpen(s.id);
        return (
          <View
            key={s.id}
            className="rounded-lg border border-edge bg-surface-1"
            testID={`metadata-section-${s.id}`}
          >
            <Pressable
              onPress={() => toggle(s.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              className="flex-row items-center justify-between gap-2 px-3"
              style={{ minHeight: hitTarget }}
            >
              <View className="flex-1 flex-row flex-wrap items-center gap-2">
                <Text className="font-semibold">
                  {t(`tools.metadata.categories.${s.id}`, { defaultValue: s.id })}
                </Text>
                <Num className="text-sm text-muted-fg">{s.rows.length}</Num>
                {s.privacy.map((p) => (
                  <Text key={p} className="text-xs text-primary">
                    {privacyLabel(p)}
                  </Text>
                ))}
              </View>
              <Text className="text-muted-fg">{open ? '▴' : '▾'}</Text>
            </Pressable>
            {open ? (
              <View className="px-3 pb-1">
                {s.rows.map((r) => (
                  <RowView
                    key={r.entry.id}
                    row={r}
                    onCopy={(row) => void copy(`${row.label}: ${row.text}`)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <Button
        label={t('tools.metadata.copyAll')}
        variant="ghost"
        onPress={() => void copy(documentAsText(rows))}
        testID="metadata-copy-all"
      />
    </View>
  );
}

// i18n-keys: tools.metadata.kind.image, tools.metadata.kind.video, tools.metadata.kind.audio, tools.metadata.kind.document, tools.metadata.kind.unknown, tools.metadata.privacy.location, tools.metadata.privacy.identity, tools.metadata.privacy.device, tools.metadata.privacy.history, tools.metadata.categories.file, tools.metadata.categories.image, tools.metadata.categories.camera, tools.metadata.categories.lens, tools.metadata.categories.gps, tools.metadata.categories.datetime, tools.metadata.categories.color, tools.metadata.categories.thumbnail, tools.metadata.categories.iptc, tools.metadata.categories.xmp, tools.metadata.categories.history, tools.metadata.categories.video, tools.metadata.categories.audio, tools.metadata.categories.container, tools.metadata.categories.apple, tools.metadata.categories.png, tools.metadata.categories.pdf, tools.metadata.categories.c2pa, tools.metadata.categories.pano, tools.metadata.categories.makernote, tools.metadata.categories.composite, tools.metadata.categories.other, tools.metadata.summary.tagCount
