/**
 * History's Projects segment (MA52 decision 4, generalised by MA58 decision 1): Aperture
 * (`GET /photo/projects`), Darkroom (`GET /studio/projects`) and Motion (`GET /vector/projects`)
 * projects merged newest first, under a filter chip row (All · Aperture · Darkroom · Motion,
 * remembered in MMKV, default All).
 *
 *  - Aperture rows: tap opens the editor; swipe to the end edge (or long press) deletes behind a
 *    confirm (Aperture only: phase 0 never deletes a Darkroom/Motion project).
 *  - Darkroom rows: thumbnail = tile 0 of the first video clip's filmstrip sprite (else a film
 *    icon), duration; tap or "…" opens the actions: Export, Exports, Open on the web.
 *  - Motion rows: the Motion icon (the API serves no thumbnail URL yet), tap or "…": Open on the web.
 *  - Errors are per source: a failing source shows an inline line with Retry, the others still list.
 *  - Pull to refresh refetches every source.
 */
import { Image } from 'expo-image';
import type { Href } from 'expo-router';
import { Ellipsis, Film, SlidersHorizontal, Spline } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, I18nManager, Pressable, RefreshControl, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { openWebPage } from '@/account/openWeb';
import { EVENTS } from '@/analytics/events';
import { trackPhotoProjectDeleted } from '@/analytics/photoEvents';
import { track } from '@/analytics/track';
import { buildHeaders } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import type { PhotoProject } from '@/api/schemas/photo';
import type { StudioProjectSummary } from '@/api/schemas/studio';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import { editorHref } from '@/photo/openRequest';
import { useDeletePhotoProjectMutation, useListPhotoProjectsQuery } from '@/photo/projectsApi';
import {
  studioSpriteUri,
  studioThumbAssetId,
  useListStudioProjectsQuery,
} from '@/studio/mobile/api';
import { StudioExportSheet } from '@/studio/mobile/ui/export/StudioExportSheet';
import { StudioExportsSheet } from '@/studio/mobile/ui/export/StudioExportsSheet';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { EmptyState } from '@/ui/components/EmptyState';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import { showNotice } from '@/ui/notice';
import { colors, hitTarget } from '@/ui/tokens';
import { darkroomWebUrl, motionEditorWebUrl, useListVectorProjectsQuery } from '@/vector/mobile/api';
import { useProjectsFilter } from './filterPref';
import {
  filterRows,
  mergeProjects,
  type ProjectProduct,
  type ProjectRow,
  type ProjectsFilter,
} from './merge';

const THUMB = 56;

/** `thumbUrl` is API-relative (`/api/photo/projects/<id>/thumb`); the base already ends in `/api`. */
export function thumbUri(p: Pick<PhotoProject, 'id' | 'thumbUrl'>): string {
  const rel = p.thumbUrl?.replace(/^\/api(?=\/)/, '');
  return `${API_BASE_URL}${rel || `/photo/projects/${encodeURIComponent(p.id)}/thumb`}`;
}

function useAuthHeaders(): Record<string, string> | null {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    void buildHeaders().then((h) => live && setHeaders(h));
    return () => {
      live = false;
    };
  }, []);
  return headers;
}

/** The product's display name: Aperture and Darkroom from the existing keys, Motion its own. */
export function useProductLabel(): (p: ProjectProduct) => string {
  const { t } = useTranslation();
  return (p) =>
    p === 'aperture'
      ? t('tools.items.aperture.title')
      : p === 'darkroom'
        ? t('interface:contentStudio.title')
        : t('projects.filter.motion');
}

function Badge({ label }: { label: string }) {
  return (
    <View className="rounded-sm border border-edge px-1.5">
      <Text className="text-xs text-muted-fg">{label}</Text>
    </View>
  );
}

function Thumb({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-md bg-surface-2"
      style={{ width: THUMB, height: THUMB }}
    >
      {children}
    </View>
  );
}

function ApertureRow({
  project,
  headers,
  onOpen,
  onDelete,
  badge,
}: {
  project: PhotoProject;
  headers: Record<string, string> | null;
  onOpen(p: PhotoProject): void;
  onDelete(p: PhotoProject): void;
  badge: string;
}) {
  const { t } = useTranslation();
  const name = project.name.trim() || t('interface:photo.untitled');
  const ready = project.status === 'ready';
  const body = (
    <Pressable
      testID={`project-row-${project.id}`}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled: !ready }}
      accessibilityActions={[{ name: 'delete', label: t('history.actions.delete') }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'delete') onDelete(project);
      }}
      onPress={() => ready && onOpen(project)}
      onLongPress={() => onDelete(project)}
      className="flex-row items-center gap-3 bg-surface-0 px-4 py-3"
      style={{ minHeight: hitTarget }}
    >
      <Thumb>
        {headers && ready ? (
          <Image
            testID={`project-thumb-${project.id}`}
            source={{ uri: thumbUri(project), headers }}
            style={{ width: THUMB, height: THUMB }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={`${project.id}:${project.updatedAt ?? ''}`}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <SlidersHorizontal size={20} color={colors.mutedFg} />
        )}
      </Thumb>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="flex-shrink text-base font-semibold" numberOfLines={1}>
            {name}
          </Text>
          <Badge label={badge} />
        </View>
        <View className="flex-row flex-wrap items-center gap-x-2">
          {project.updatedAt ? (
            <Num className="text-xs text-muted-fg">
              {t('history.projects.updated', { date: formatDateTime(project.updatedAt) })}
            </Num>
          ) : null}
          {project.width > 0 && project.height > 0 ? (
            <Num className="text-xs text-muted-fg">
              {t('history.projects.dimensions', { width: project.width, height: project.height })}
            </Num>
          ) : null}
          {project.originalBytes ? (
            <Num className="text-xs text-muted-fg">{formatBytes(project.originalBytes)}</Num>
          ) : null}
        </View>
        {!ready ? (
          <Text className="text-xs text-subtle">{t('history.projects.notReady')}</Text>
        ) : null}
      </View>
    </Pressable>
  );
  // The logical end edge (HistoryRow's rule): physical right in LTR, left in RTL.
  const renderEnd = (_p: unknown, _t: unknown, methods: { close(): void }) => (
    <Pressable
      testID={`project-delete-${project.id}`}
      accessibilityRole="button"
      accessibilityLabel={t('history.actions.delete')}
      onPress={() => {
        methods.close();
        onDelete(project);
      }}
      className="items-center justify-center bg-danger px-4"
      style={{ minWidth: 88, minHeight: hitTarget }}
    >
      <Text className="text-sm font-semibold text-on-primary">{t('history.actions.delete')}</Text>
    </Pressable>
  );
  const endProps = I18nManager.isRTL
    ? { renderLeftActions: renderEnd }
    : { renderRightActions: renderEnd };
  return (
    <ReanimatedSwipeable friction={2} overshootRight={false} overshootLeft={false} {...endProps}>
      {body}
    </ReanimatedSwipeable>
  );
}

/** A Darkroom or Motion row: no swipe, tap and "…" open the actions sheet. */
function WebProjectRow({
  row,
  name,
  badge,
  onMenu,
}: {
  row: Extract<ProjectRow, { product: 'darkroom' | 'motion' }>;
  name: string;
  badge: string;
  onMenu(row: ProjectRow): void;
}) {
  const { t } = useTranslation();
  const id = row.project.id;
  const spriteAsset = row.product === 'darkroom' ? studioThumbAssetId(row.project) : null;
  const updated = row.project.updatedAt;
  return (
    <View className="flex-row items-center bg-surface-0" style={{ minHeight: hitTarget }}>
      <Pressable
        testID={`project-row-${id}`}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${badge}`}
        onPress={() => onMenu(row)}
        className="flex-1 flex-row items-center gap-3 py-3 ps-4"
      >
        <Thumb>
          {spriteAsset ? (
            // The sprite is 60 tiles of 160 px in one row: covering the height and pinning the
            // physical left edge shows tile 0 (the sprite is an image, not layout: never mirrored).
            <Image
              testID={`project-thumb-${id}`}
              source={{ uri: studioSpriteUri(spriteAsset) }}
              style={{ width: THUMB, height: THUMB }}
              contentFit="cover"
              contentPosition="left"
              cachePolicy="memory-disk"
              recyclingKey={`${id}:${spriteAsset}`}
              accessibilityIgnoresInvertColors
            />
          ) : row.product === 'darkroom' ? (
            <Film size={20} color={colors.mutedFg} />
          ) : (
            <Spline size={20} color={colors.data} />
          )}
        </Thumb>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="flex-shrink text-base font-semibold" numberOfLines={1}>
              {name}
            </Text>
            <Badge label={badge} />
          </View>
          <View className="flex-row flex-wrap items-center gap-x-2">
            {updated ? (
              <Num className="text-xs text-muted-fg">
                {t('history.projects.updated', { date: formatDateTime(updated) })}
              </Num>
            ) : null}
            {row.product === 'darkroom' && row.project.durationSeconds > 0 ? (
              <Num className="text-xs text-muted-fg" testID={`project-duration-${id}`}>
                {formatDuration(row.project.durationSeconds)}
              </Num>
            ) : null}
            {row.product === 'darkroom' && row.project.width > 0 && row.project.height > 0 ? (
              <Num className="text-xs text-muted-fg">
                {t('history.projects.dimensions', {
                  width: row.project.width,
                  height: row.project.height,
                })}
              </Num>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        testID={`project-menu-${id}`}
        accessibilityRole="button"
        accessibilityLabel={t('projects.actions.more')}
        onPress={() => onMenu(row)}
        className="items-center justify-center pe-4 ps-2"
        style={{ minWidth: hitTarget, minHeight: hitTarget }}
      >
        <Ellipsis size={20} color={colors.mutedFg} />
      </Pressable>
    </View>
  );
}

function SourceError({ label, onRetry, testID }: { label: string; onRetry(): void; testID: string }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-3 px-4 py-2" testID={testID}>
      <Text className="flex-1 text-sm text-muted-fg">{label}</Text>
      <Button label={t('history.retry')} variant="ghost" onPress={onRetry} />
    </View>
  );
}

// i18n-keys: projects.empty.all.title, projects.empty.all.body, projects.empty.darkroom.title, projects.empty.darkroom.body, projects.empty.motion.title, projects.empty.motion.body, projects.loadFailed.darkroom, projects.loadFailed.motion
export function ProjectsList({
  onOpenTools,
  aperture = true,
}: {
  onOpenTools(): void;
  /** False when Aperture is off for the account (`GET /photo/capabilities`): no source, no chip. */
  aperture?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const label = useProductLabel();
  const photo = useListPhotoProjectsQuery(undefined, { skip: !aperture });
  const studio = useListStudioProjectsQuery();
  const vector = useListVectorProjectsQuery();
  const [remove] = useDeletePhotoProjectMutation();
  const headers = useAuthHeaders();
  const [storedFilter, setFilter] = useProjectsFilter();
  const filter: ProjectsFilter = !aperture && storedFilter === 'aperture' ? 'all' : storedFilter;
  const [confirm, setConfirm] = useState<PhotoProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState<Extract<ProjectRow, { product: 'darkroom' | 'motion' }> | null>(
    null,
  );
  const [exportFor, setExportFor] = useState<StudioProjectSummary | null>(null);
  const [exportsFor, setExportsFor] = useState<StudioProjectSummary | null>(null);

  const all = useMemo(
    () =>
      mergeProjects({
        aperture: aperture ? photo.data : [],
        darkroom: studio.data,
        motion: vector.data,
      }),
    [aperture, photo.data, studio.data, vector.data],
  );
  const rows = useMemo(() => filterRows(all, filter), [all, filter]);

  const sources = [
    ...(aperture ? [{ product: 'aperture' as const, q: photo }] : []),
    { product: 'darkroom' as const, q: studio },
    { product: 'motion' as const, q: vector },
  ].filter((s) => filter === 'all' || s.product === filter);
  const failed = sources.filter((s) => s.q.isError);
  const loading = sources.some((s) => s.q.isLoading);
  const refreshing = sources.some((s) => s.q.isFetching && !s.q.isLoading);
  const refetchAll = () => {
    if (aperture) void photo.refetch();
    void studio.refetch();
    void vector.refetch();
  };

  const nameOf = (r: ProjectRow): string =>
    r.product === 'aperture'
      ? r.project.name.trim() || t('interface:photo.untitled')
      : r.product === 'motion'
        ? r.project.name.trim() || t('interface:vector.untitled')
        : r.project.name.trim() || t('projects.untitled');

  const openPhoto = (p: PhotoProject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router') as typeof import('expo-router');
    router.push(editorHref(p.id, { from: 'projects' }) as Href);
  };

  const openMenu = (r: ProjectRow) => {
    if (r.product === 'aperture') return;
    if (r.product === 'darkroom')
      track(
        EVENTS.STUDIO_PROJECT_OPENED,
        { host: 'mm', surface: 'app_list' },
        { tool_slug: 'darkroom', feature: 'studio' },
      );
    setMenu(r);
  };

  const doDelete = async (p: PhotoProject) => {
    setDeleting(true);
    try {
      await remove(p.id).unwrap();
      trackPhotoProjectDeleted();
      showNotice(t('history.projects.deleted'));
    } catch {
      showNotice(t('history.projects.deleteFailed'), 'error');
    } finally {
      setDeleting(false);
      setConfirm(null);
    }
  };

  const filters: ProjectsFilter[] = aperture
    ? ['all', 'aperture', 'darkroom', 'motion']
    : ['all', 'darkroom', 'motion'];
  const chips = (
    <View className="px-4 pb-2" testID="projects-filter">
      <Chips
        label={t('projects.filter.label')}
        options={filters.map((f) => ({
          value: f,
          label: f === 'all' ? t('projects.filter.all') : label(f),
        }))}
        value={filter}
        onChange={(f) => {
          if (f === filter) return;
          setFilter(f);
          track(EVENTS.PROJECTS_FILTER_CHANGED, { filter: f });
        }}
        testIDPrefix="projects-filter"
      />
    </View>
  );

  const errorLines = (
    <>
      {failed.map((s) => (
        <SourceError
          key={s.product}
          testID={`projects-error-${s.product}`}
          label={
            s.product === 'aperture'
              ? t('history.projects.loadFailed')
              : t(`projects.loadFailed.${s.product}`)
          }
          onRetry={() => void s.q.refetch()}
        />
      ))}
    </>
  );

  const emptyKey = filter === 'aperture' ? null : filter;
  const allFailed = failed.length === sources.length && rows.length === 0;

  return (
    <View className="flex-1" testID="projects-list">
      {chips}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) =>
          item.product === 'aperture' ? (
            <ApertureRow
              project={item.project}
              headers={headers}
              onOpen={openPhoto}
              onDelete={setConfirm}
              badge={label('aperture')}
            />
          ) : (
            <WebProjectRow
              row={item}
              name={nameOf(item)}
              badge={label(item.product)}
              onMenu={openMenu}
            />
          )
        }
        ListHeaderComponent={errorLines}
        contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetchAll}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          loading || allFailed ? null : emptyKey === null ? (
            <EmptyState
              icon={SlidersHorizontal}
              title={t('history.projects.empty.title')}
              body={t('history.projects.empty.body')}
              actionLabel={t('history.empty.cta')}
              onAction={onOpenTools}
            />
          ) : (
            <EmptyState
              icon={emptyKey === 'motion' ? Spline : emptyKey === 'darkroom' ? Film : SlidersHorizontal}
              title={t(`projects.empty.${emptyKey}.title`)}
              body={t(`projects.empty.${emptyKey}.body`)}
              {...(emptyKey === 'all'
                ? { actionLabel: t('history.empty.cta'), onAction: onOpenTools }
                : {})}
            />
          )
        }
      />
      <Sheet visible={confirm !== null} onClose={() => setConfirm(null)}>
        <View className="gap-3" testID="project-delete-sheet">
          <Text className="text-base font-semibold">{t('history.projects.deleteTitle')}</Text>
          <Text className="text-muted-fg">{t('history.projects.deleteBody')}</Text>
          <Button
            testID="project-delete-confirm"
            variant="danger"
            label={t('history.actions.delete')}
            loading={deleting}
            onPress={() => confirm && void doDelete(confirm)}
          />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setConfirm(null)} />
        </View>
      </Sheet>
      <Sheet visible={menu !== null} onClose={() => setMenu(null)}>
        {menu ? (
          <View className="gap-3" testID="project-actions-sheet">
            <Text className="text-base font-semibold" numberOfLines={2}>
              {t('history.actions.title', { name: nameOf(menu) })}
            </Text>
            {menu.product === 'darkroom' ? (
              <>
                <Button
                  testID="project-action-export"
                  label={t('interface:contentStudio.export.button')}
                  onPress={() => {
                    setExportFor(menu.project);
                    setMenu(null);
                  }}
                />
                <Button
                  testID="project-action-exports"
                  variant="secondary"
                  label={t('interface:contentStudio.exports.open')}
                  onPress={() => {
                    setExportsFor(menu.project);
                    setMenu(null);
                  }}
                />
              </>
            ) : null}
            <Button
              testID="project-action-web"
              variant="secondary"
              label={t('assistant.openOnWeb')}
              onPress={() => {
                const url =
                  menu.product === 'motion'
                    ? motionEditorWebUrl(menu.project.id)
                    : darkroomWebUrl(locale);
                setMenu(null);
                void openWebPage(url);
              }}
            />
            {menu.product === 'darkroom' ? (
              <Text className="text-sm text-subtle">{t('projects.darkroomWebHint')}</Text>
            ) : null}
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setMenu(null)} />
          </View>
        ) : null}
      </Sheet>
      <StudioExportSheet project={exportFor} onClose={() => setExportFor(null)} />
      <StudioExportsSheet project={exportsFor} onClose={() => setExportsFor(null)} />
    </View>
  );
}
