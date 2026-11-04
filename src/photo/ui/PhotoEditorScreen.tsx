/**
 * The Aperture editor (ticket MA50 decision 7): a full-bleed `PhotoCanvas`, a top bar (back with an
 * unsaved-changes confirm, the project name, Undo / Redo, Save, Export), an upload chip while the
 * original uploads, and a bottom tool strip opening the sheets (Basic · Colour · Curves · Levels ·
 * B&W · More · Layers). The chrome follows the locale's direction; the canvas and the graphs are
 * always LTR.
 */
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { router, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, ScrollView, View } from 'react-native';
import {
  trackPhotoCompareUsed,
  trackPhotoEditorOpened,
  trackPhotoExportStarted,
  trackPhotoProjectCreated,
  trackPhotoProjectSaved,
  createAdjustmentTracker,
  PHOTO_TOOL_SLUG,
} from '@/analytics/photoEvents';
import { setContext } from '@/analytics/track';
import { mmApi } from '@/api/mmApi';
import { getJobEngine } from '@/jobs/runtime';
import { photoExportOptions, PHOTO_EXPORT_STARTER } from '@/jobs/starters/photoExport';
import { LimitSheet, hasLimitSheet } from '@/quota/LimitSheets';
import { mmkvStorage } from '@/state/persist';
import { useAppSelector } from '@/state/hooks';
import { store as appStore } from '@/state/store';
import { observed } from '@/state/slices/quota';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import { showNotice } from '@/ui/notice';
import type { MmError } from '@/api/errors';
import { createDraftWriter, draftKey, localDraftKey, type Draft } from '../drafts';
import {
  effectiveMegapixels,
  exportBody,
  exportOptionsHash,
  type ExportChoice,
} from '../exportPlan';
import type { Histogram64 } from '../histogram';
import { NEW_PROJECT, takePhotoOpenRequest, type PhotoOpenRequest } from '../openRequest';
import { createPhotoProject, realCreateDeps } from '../projectCreate';
import { photoApi, useGetPhotoCapabilitiesQuery } from '../projectsApi';
import { refusalCopy } from '../refusals';
import { makePhotoStore } from '../photoStore';
import { PhotoCanvas, type DocFeed } from '../skia/PhotoCanvas';
import { renderHealMaskPng } from '../skia/healMask';
import { decodeBaseProxy, skiaSourceDeps, subjectMaskBytes } from '../skia/sourceDeps';
import { realAiDeps } from '../aiApi';
import { useToolOverlay } from '../tools/ToolOverlay';
import { useEditorWorkspace, type WorkspaceIo } from './useEditorWorkspace';
import { createSession, type UploadStatus } from '../session';
import { loadLocalPreview, loadProxyPreview, type PreviewSource } from '../source';
import { ConflictSheet, DraftSheet, UnsavedSheet } from './ConflictSheet';
import { EditorProvider } from './EditorContext';
import { SheetBody, ToolStrip, TopBar, type StripTool } from './EditorChrome';
import { ExportSheet } from './ExportSheet';
import { HistogramView } from './HistogramView';

const TOOLS_TAB = '/(app)/(tabs)' as Href;

// The session's API calls over RTK Query (getProject/saveProject) and the native create upload.
function sessionApi() {
  const dispatch = appStore.dispatch;
  return {
    createProject: (
      i: Parameters<typeof createPhotoProject>[0],
      onProgress: (f: number) => void,
      signal: AbortSignal,
    ) =>
      createPhotoProject(
        i,
        realCreateDeps((q) => dispatch(observed(q))),
        onProgress,
        signal,
      ),
    async getProject(id: string) {
      const r = await dispatch(
        photoApi.endpoints.getPhotoProject.initiate(id, { forceRefetch: true, subscribe: false }),
      );
      return r.error
        ? { ok: false as const, error: r.error as MmError }
        : { ok: true as const, response: r.data! };
    },
    async saveProject(i: {
      id: string;
      revision: number;
      doc: import('../photoTypes').PhotoDoc;
      name?: string;
    }) {
      const r = await dispatch(photoApi.endpoints.savePhotoProject.initiate(i));
      return 'error' in r && r.error
        ? { ok: false as const, error: r.error as MmError }
        : { ok: true as const, response: (r as { data: never }).data };
    },
  };
}

/** Native I/O of the MA51 workspace (AI routes, cached files, the base-size heal mask). */
function workspaceIo(): WorkspaceIo {
  return {
    ai: realAiDeps((q) => appStore.dispatch(observed(q))),
    subjectBytes: subjectMaskBytes,
    baseImage: decodeBaseProxy,
    async writeMask(bytes) {
      const f = new File(Paths.cache, `photo-heal-mask-${Date.now()}.png`);
      f.create();
      f.write(bytes);
      return f.uri;
    },
    renderHealMask: (strokes, size) => renderHealMaskPng(Skia, strokes, size),
    pending: mmkvStorage,
  };
}

export interface PhotoEditorScreenProps {
  projectId: string;
  /** Tests inject; the route reads `takePhotoOpenRequest()`. */
  request?: PhotoOpenRequest | null;
}

export function PhotoEditorScreen({ projectId, request: injected }: PhotoEditorScreenProps) {
  const { t } = useTranslation();
  const store = useMemo(() => makePhotoStore(), []);
  const session = useMemo(
    () => createSession({ api: sessionApi(), store, drafts: mmkvStorage as never, now: Date.now }),
    [store],
  );
  const request = useMemo(
    () => (projectId === NEW_PROJECT ? (injected ?? takePhotoOpenRequest()) : null),
    [projectId, injected],
  );
  const slug = request?.toolSlug ?? PHOTO_TOOL_SLUG;
  const haptics = useAppSelector((s) => s.settings.haptics);
  const caps = useGetPhotoCapabilitiesQuery();
  const adjust = useMemo(() => createAdjustmentTracker(), []);

  const [preview, setPreview] = useState<PreviewSource<SkImage> | null>(null);
  const [failed, setFailed] = useState(false);
  const [upload, setUpload] = useState<UploadStatus>({ kind: 'idle' });
  const [sheet, setSheet] = useState<StripTool | null>(null);
  const [histogram, setHistogram] = useState<Histogram64 | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [limitError, setLimitError] = useState<MmError | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => setContext({ tool_slug: slug }), [slug]);
  useEffect(() => {
    const off = session.subscribe(() => setUpload(session.upload()));
    return () => {
      off();
    };
  }, [session]);
  useEffect(
    () => () => {
      session.dispose();
      adjust.dispose();
    },
    [session, adjust],
  );

  // Open: a picked file (decode locally at once, upload in the background) or a saved project.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (request) {
        const f = request.file;
        const local = await loadLocalPreview(skiaSourceDeps, f.uri, {
          width: f.width,
          height: f.height,
        });
        if (cancelled) return;
        if (local) setPreview(local);
        const w = f.width ?? local?.width ?? 1;
        const h = f.height ?? local?.height ?? 1;
        trackPhotoEditorOpened(request.source, !!local, slug);
        const done = session.openFile({
          intakeId: f.id,
          uri: f.uri,
          mimeType: f.mimeType,
          name: f.name.replace(/\.[^.]+$/, ''),
          width: w,
          height: h,
        });
        const res = await done;
        if (cancelled) return;
        const project = session.project();
        if (res.kind === 'ready' && project) {
          trackPhotoProjectCreated(
            f.extension,
            (project.width * project.height) / 1_000_000,
            project.hasAlpha ?? false,
            slug,
          );
          if (!local) {
            const proxy = await loadProxyPreview(skiaSourceDeps, project.id, project);
            if (!cancelled) {
              if (proxy) setPreview(proxy);
              else setFailed(true);
            }
          }
        } else if (res.kind === 'failed') {
          const copy = refusalCopy(res.error);
          if (hasLimitSheet(res.error)) setLimitError(res.error);
          else if (copy) showNotice(t(copy.key, copy.values), 'error');
          if (!local) setFailed(true);
        }
        return;
      }
      if (projectId === NEW_PROJECT) {
        router.replace(TOOLS_TAB);
        return;
      }
      const r = await session.openProject(projectId);
      if (cancelled) return;
      if (!r.ok) return setFailed(true);
      const proxy = await loadProxyPreview(skiaSourceDeps, projectId, r.response.project);
      if (cancelled) return;
      if (proxy) setPreview(proxy);
      else setFailed(true);
      trackPhotoEditorOpened('projects', false, slug);
      if (r.recovered) setDraft(r.recovered);
    })();
    return () => {
      cancelled = true;
    };
  }, [request, projectId, session, slug, t]);

  // Drafts: every 2 s while dirty, flushed when the app goes to the background.
  useEffect(() => {
    const writer = createDraftWriter(mmkvStorage as never, () => {
      const s = store.getState();
      if (!s.doc || !s.dirty) return null;
      const key = s.projectId
        ? draftKey(s.projectId)
        : request
          ? localDraftKey(request.file.id)
          : null;
      return key
        ? {
            key,
            draft: {
              doc: s.doc,
              baseRevision: s.serverRevision,
              savedAt: Date.now(),
              name: s.name,
            },
          }
        : null;
    });
    const unsub = store.subscribe(() => {
      if (store.getState().dirty) writer.schedule();
    });
    const app = AppState.addEventListener('change', (st) => {
      if (st !== 'active') void writer.flush();
    });
    return () => {
      unsub();
      app.remove();
      void writer.flush();
    };
  }, [store, request]);

  const feed: DocFeed = useMemo(
    () => ({ get: () => store.getState().doc, subscribe: store.subscribe }),
    [store],
  );
  const dirty = usePhotoDirty(store);

  usePreventRemove(dirty && !leaving, () => setUnsaved(true));

  const save = useCallback(async () => {
    setSaving(true);
    const r = await session.save();
    setSaving(false);
    if (r.kind === 'saved') {
      const d = store.getState().doc;
      if (d) trackPhotoProjectSaved(d, slug);
      showNotice(t('photo.saved'));
    } else if (r.kind === 'conflict') setConflict(r.serverRevision);
    else if (r.kind === 'failed') {
      if (hasLimitSheet(r.error)) setLimitError(r.error);
      else showNotice(t('photo.saveFailed'), 'error');
    }
  }, [session, store, slug, t]);

  const startExport = useCallback(
    (choice: ExportChoice) => {
      const s = store.getState();
      const project = session.project();
      const file = request?.file;
      if (!s.doc || !project) return;
      const cap = caps.data?.maxMegapixels ?? 12;
      const mp = effectiveMegapixels(s.doc, choice.maxSize, cap);
      trackPhotoExportStarted(s.doc, choice.format, mp, slug);
      const ids = getJobEngine().startJobs([
        {
          tool: {
            id: 'aperture',
            family: 'image',
            analyticsSlug: slug,
            endpoint: 'photoProject',
            optionsBuilder: (f) => f,
          },
          file: file ?? {
            id: `photo:${project.id}`,
            uri: '',
            name: `${project.name}.${project.originalExt ?? 'jpg'}`,
            extension: project.originalExt ?? 'jpg',
            mimeType: 'image/jpeg',
            mediaKind: 'image',
            sizeBytes: project.originalBytes ?? 0,
            source: 'picker',
            copiedAt: Date.now(),
          },
          starter: PHOTO_EXPORT_STARTER,
          options: photoExportOptions({
            projectId: project.id,
            revision: s.serverRevision ?? undefined,
            body: exportBody(s.doc, choice, s.name || undefined),
            megapixels: mp,
          }),
          optionsHash: exportOptionsHash(s.doc, choice.format, mp),
        },
      ]);
      // The export saves the doc first (revision + 1): once the server accepted it, re-read the
      // revision so the next Save does not 409.
      const exported = s.doc;
      const localId = ids[0];
      if (localId) {
        const unsub = appStore.subscribe(() => {
          const rec = appStore.getState().jobs.byLocalId[localId];
          if (!rec || rec.state === 'queued' || rec.state === 'uploading') return;
          unsub();
          if (rec.jobId) void session.afterExport(exported);
        });
      }
      appStore.dispatch(mmApi.util.invalidateTags(['History']));
      setExportOpen(false);
      if (localId) router.push(`/(app)/job/${localId}`);
    },
    [store, session, request, caps.data, slug],
  );

  const onCompare = useCallback(
    (mode: 'hold' | 'toggle', on: boolean) => {
      if (on) trackPhotoCompareUsed(mode === 'hold' ? 'hold' : 'split', slug);
    },
    [slug],
  );

  const io = useMemo(() => workspaceIo(), []);
  // The project id lands in the store once the upload / open finishes (Select subject and Heal need it).
  const storeProjectId = usePhotoProjectId(store);
  const ws = useEditorWorkspace({
    api: Skia,
    io,
    store,
    original: preview?.image ?? null,
    projectId: storeProjectId,
    capabilities: caps.data ? { aiMasks: caps.data.aiMasks, heal: caps.data.heal } : undefined,
    slug,
    gpu: true,
    onLimit: (e) => {
      if (!hasLimitSheet(e)) return false;
      setLimitError(e);
      return true;
    },
    onNotice: (key, kind) => showNotice(t(key), kind),
  });
  const [toolRevision, setToolRevision] = useState(0);
  useEffect(() => ws.tools.subscribe(() => setToolRevision((n) => n + 1)), [ws.tools]);
  const toolHost = useToolOverlay(
    {
      store,
      tools: ws.tools,
      sourceSize: ws.extra.sourceSize,
      readPixel: ws.readPixel,
      brushAlpha: ws.brushAlpha,
      encodePng: ws.encodePng,
      onBrushBaked: ws.onBrushBaked,
      healStrokes: ws.healStrokes,
      onMaskAdded: ws.onMaskAdded,
      onRefused: (r) =>
        showNotice(
          t(
            r === 'no_layer'
              ? 'interface:photo.masks.selectLayer'
              : r === 'brush_full'
                ? 'interface:photo.masks.brush.full'
                : 'interface:photo.masks.brush.warn',
          ),
          r === 'no_layer' ? undefined : 'error',
        ),
    },
    toolRevision + ws.assetsRevision,
  );
  const armed = ws.tools.get().tool;
  const zoomActual = ws.tools.get().zoomActual;
  // The sheet is a modal over the canvas: while a canvas tool is armed it steps aside for a slim
  // bar (tool name + Done), and comes back when the tool is put down. toolRevision re-renders.
  void toolRevision;
  const sheetHidden = armed !== 'none';
  // i18n-keys: photo.tools.none, photo.tools.gradient, photo.tools.radial, photo.tools.brush, photo.tools.eyedropper, photo.tools.crop, photo.tools.straighten, photo.tools.perspective, photo.tools.heal, photo.tools.redEye, photo.masks.needsProject, photo.heal.tooLarge, photo.heal.needsProject

  const editorApi = useMemo(
    () => ({
      store,
      haptics,
      noteAdjustment: (a: string, p: string) => adjust.note(a, p),
      extra: ws.extra,
    }),
    [store, haptics, adjust, ws.extra],
  );

  const doc = store.getState().doc;
  const leave = () => {
    setLeaving(true);
    setUnsaved(false);
  };
  // Leave once the prevent-remove guard has been released by the render above.
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving]);

  return (
    <EditorProvider value={editorApi}>
      <View className="flex-1 bg-surface-0">
        <TopBar
          name={store.getState().name}
          upload={upload}
          saving={saving}
          onBack={() => (dirty ? setUnsaved(true) : router.back())}
          onSave={() => void save()}
          onExport={() => setExportOpen(true)}
        />
        <View className="flex-1" style={{ direction: 'ltr' }}>
          {preview && ws.source ? (
            <PhotoCanvas
              testID="photo-canvas"
              image={ws.source.image}
              sourceId={ws.source.id}
              previewScale={preview.scale}
              doc={feed}
              pipeline={ws.pipeline}
              tools={toolHost}
              assetsRevision={ws.assetsRevision}
              zoomActual={zoomActual}
              onHistogram={setHistogram}
              onCompare={onCompare}
            />
          ) : (
            <View className="flex-1 items-center justify-center p-6">
              <Text className="text-muted-fg">
                {failed ? t('photo.decodeFailed') : t('photo.waitingForPreview')}
              </Text>
            </View>
          )}
          {preview?.origin === 'proxy' || (preview && preview.scale < 1) ? (
            <View pointerEvents="none" className="absolute bottom-2 end-2 start-2">
              <Text testID="photo-reduced-note" className="text-center text-xs text-subtle">
                {t('photo.previewReduced')}
              </Text>
            </View>
          ) : null}
        </View>
        {upload.kind === 'failed' && !hasLimitSheet(upload.error) && !refusalCopy(upload.error) ? (
          <View className="gap-2 bg-surface-1 p-3">
            <Text className="text-sm text-muted-fg">{t('photo.uploadFailed')}</Text>
            <Button
              variant="secondary"
              label={t('photo.uploadRetry')}
              onPress={() => {
                const f = request?.file;
                const d = store.getState().doc;
                if (f && d)
                  void session.retryUpload({
                    intakeId: f.id,
                    uri: f.uri,
                    mimeType: f.mimeType,
                    name: f.name,
                    width: d.source.width,
                    height: d.source.height,
                  });
              }}
            />
          </View>
        ) : null}
        {sheetHidden ? (
          <View className="flex-row items-center gap-2 border-t border-edge bg-surface-1 px-3 py-2">
            <Text testID="photo-tool-armed" className="flex-1 text-sm">
              {t(`photo.tools.${armed}`)}
            </Text>
            <Button
              testID="photo-tool-done"
              label={t('photo.tools.done')}
              onPress={() => ws.tools.set({ tool: 'none' })}
            />
          </View>
        ) : null}
        <ToolStrip
          active={sheet}
          onPick={(k) => {
            setSheet((cur) => (cur === k ? null : k));
            // Leaving a sheet disarms its canvas tool.
            if (k !== 'masks' && k !== 'geometry' && k !== 'heal') ws.tools.set({ tool: 'none' });
          }}
        />
      </View>

      <Sheet visible={sheet !== null && !sheetHidden} onClose={() => setSheet(null)}>
        <View style={{ maxHeight: 460 }}>
          {sheet === 'basic' || sheet === 'curves' ? (
            <HistogramView histogram={histogram} height={48} />
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pt-2">
            {sheet ? (
              <SheetBody
                tool={sheet}
                histogram={histogram}
                hooks={{
                  encodePng: ws.encodePng,
                  brushAlpha: ws.brushAlpha,
                  onMaskAdded: ws.onMaskAdded,
                }}
              />
            ) : null}
          </ScrollView>
        </View>
      </Sheet>

      {doc ? (
        <ExportSheet
          visible={exportOpen}
          onClose={() => setExportOpen(false)}
          doc={doc}
          capabilities={caps.data}
          ready={upload.kind === 'ready'}
          onExport={startExport}
        />
      ) : null}
      <ConflictSheet
        visible={conflict !== null}
        onClose={() => setConflict(null)}
        onKeepMine={async () => {
          const rev = conflict;
          setConflict(null);
          if (rev !== null) {
            const r = await session.keepMine(rev);
            if (r.kind === 'saved') showNotice(t('photo.saved'));
          }
        }}
        onLoadTheirs={async () => {
          setConflict(null);
          await session.loadTheirs();
        }}
      />
      <UnsavedSheet visible={unsaved} onClose={() => setUnsaved(false)} onDiscard={leave} />
      <DraftSheet
        visible={draft !== null}
        onRestore={() => {
          if (draft) session.recover(draft);
          setDraft(null);
          showNotice(t('photo.draftRecovered'));
        }}
        onDiscard={() => setDraft(null)}
      />
      {limitError ? (
        <LimitSheet
          visible
          error={limitError}
          toolSlug={slug}
          onClose={() => setLimitError(null)}
        />
      ) : null}
    </EditorProvider>
  );
}

function usePhotoProjectId(store: ReturnType<typeof makePhotoStore>): string | null {
  const [id, setId] = useState(store.getState().projectId);
  useEffect(() => store.subscribe(() => setId(store.getState().projectId)), [store]);
  return id;
}

function usePhotoDirty(store: ReturnType<typeof makePhotoStore>): boolean {
  const [dirty, setDirty] = useState(store.getState().dirty);
  useEffect(() => store.subscribe(() => setDirty(store.getState().dirty)), [store]);
  return dirty;
}
