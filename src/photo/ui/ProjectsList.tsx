/**
 * History's Projects segment (ticket MA52 decision 4): `GET /photo/projects` (newest first, no
 * doc), each row a thumbnail (`…/thumb`, owner-only, so the request carries `buildHeaders()`),
 * the name, the last change and the original's size. Tap opens the editor
 * (`/photo/<id>?from=projects`), a swipe to the end edge (or long press) offers Delete behind a
 * confirm (`DELETE /photo/projects/:id`), pull to refresh, and an empty state.
 */
import { Image } from 'expo-image';
import type { Href } from 'expo-router';
import { SlidersHorizontal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, I18nManager, Pressable, RefreshControl, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { trackPhotoProjectDeleted } from '@/analytics/photoEvents';
import { buildHeaders } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import type { PhotoProject } from '@/api/schemas/photo';
import { formatBytes, formatDateTime } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import { showNotice } from '@/ui/notice';
import { colors, hitTarget } from '@/ui/tokens';
import { editorHref } from '../openRequest';
import { useDeletePhotoProjectMutation, useListPhotoProjectsQuery } from '../projectsApi';

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

function ProjectRow({
  project,
  headers,
  onOpen,
  onDelete,
}: {
  project: PhotoProject;
  headers: Record<string, string> | null;
  onOpen(p: PhotoProject): void;
  onDelete(p: PhotoProject): void;
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
      <View
        className="items-center justify-center overflow-hidden rounded-md bg-surface-2"
        style={{ width: THUMB, height: THUMB }}
      >
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
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold" numberOfLines={1}>
          {name}
        </Text>
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

export function ProjectsList({ onOpenTools }: { onOpenTools(): void }) {
  const { t } = useTranslation();
  const q = useListPhotoProjectsQuery();
  const [remove] = useDeletePhotoProjectMutation();
  const headers = useAuthHeaders();
  const [confirm, setConfirm] = useState<PhotoProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const open = (p: PhotoProject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router') as typeof import('expo-router');
    router.push(editorHref(p.id, { from: 'projects' }) as Href);
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

  const projects = q.data ?? [];
  const failed = q.isError && projects.length === 0;
  const refreshing = q.isFetching && !q.isLoading;

  return (
    <View className="flex-1" testID="projects-list">
      {failed ? (
        <View className="items-center gap-3 px-8 py-10" testID="projects-error">
          <Text className="text-center text-muted-fg">{t('history.projects.loadFailed')}</Text>
          <Button label={t('history.retry')} variant="secondary" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <ProjectRow project={item} headers={headers} onOpen={open} onDelete={setConfirm} />
          )}
          contentContainerStyle={projects.length === 0 ? { flexGrow: 1 } : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void q.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            q.isLoading ? null : (
              <EmptyState
                icon={SlidersHorizontal}
                title={t('history.projects.empty.title')}
                body={t('history.projects.empty.body')}
                actionLabel={t('history.empty.cta')}
                onAction={onOpenTools}
              />
            )
          }
        />
      )}
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
    </View>
  );
}
