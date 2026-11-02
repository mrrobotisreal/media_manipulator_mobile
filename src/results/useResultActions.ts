import { File } from 'expo-file-system';
import { router, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import type { ResultContext, ResultSurface } from '@/analytics/resultEvents';
import { trackDownloadClicked } from '@/analytics/saveEvents';
import { downloadResult, ResultGoneError } from '@/files/download';
import { saveResult, shareResult, type SaveOutcome, type SaveTarget } from '@/files/save';
import { realSaveDeps } from '@/files/saveDeps';
import { setIntakeBatch } from '@/files/session';
import type { IntakeFile } from '@/files/types';
import { formatDateTime } from '@/lib/format';
import { showNotice } from '@/ui/notice';
import { realDeleteDeps, realMp3Deps, realShareDeps } from './actionDeps';
import { extensionOf, type ResultDescriptor } from './describe';
import { deleteResult } from './deleteJob';
import { convertToMp3 } from './mp3';
import { findOriginal } from './cache';
import { createAndCopyShareLink, revokeAllShareLinks } from './shareLink';

export type ActionSheet = 'more' | 'permission' | 'limit' | 'delete' | null;

export interface ActionSource {
  descriptor: ResultDescriptor;
  context: ResultContext;
  surface: ResultSurface;
  /** Registry tool for "Run another"; absent for a job opened by id with no local record. */
  tool?: { id: string; family: string; kind: 'image' | 'video' | 'audio' | 'pdf' };
  originalName: string;
  originalMime: string;
}

const TOOLS_TAB = '/(app)/(tabs)';

function sizeOf(uri: string): number {
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

/** All result actions as one hook, so `ActionsBar` stays presentational. */
export function useResultActions(src: ActionSource) {
  const { t } = useTranslation();
  const { descriptor, context } = src;
  const [progress, setProgress] = useState<number | null>(null);
  const [converting, setConverting] = useState(false);
  const [sheet, setSheet] = useState<ActionSheet>(null);
  const busy = useRef(false);
  const lastTarget = useRef<SaveTarget | undefined>(undefined);

  /** Serialises actions: a second tap while one runs is ignored (web REPEAT_GUARD_MS idea). */
  const guarded = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } catch (e) {
      // Never let an action fail silently (S25 run: Save did nothing on screen).
      if (__DEV__) console.warn('[result action] failed', e instanceof Error ? e.message : e);
      showNotice(t('save.failed'), 'error');
    } finally {
      busy.current = false;
      setProgress(null);
      setConverting(false);
    }
  }, [t]);

  const ensureFile = useCallback(async () => {
    setProgress(0);
    let last = 0;
    return downloadResult({
      jobId: descriptor.jobId,
      fileName: descriptor.fileName,
      sizeBytes: descriptor.sizeBytes,
      outputFormat: extensionOf(descriptor.fileName) || 'unknown',
      context,
      onProgress: (f) => {
        if (f - last >= 0.02 || f >= 1) {
          last = f;
          setProgress(f);
        }
      },
    });
  }, [descriptor, context]);

  const report = useCallback(
    (outcome: SaveOutcome) => {
      switch (outcome.status) {
        case 'saved':
          showNotice(
            outcome.destination === 'photos'
              ? t('save.toPhotos')
              : t('save.toFolder', { folder: outcome.folder }),
          );
          break;
        case 'permission_denied':
          setSheet('permission');
          break;
        case 'failed':
          showNotice(t('save.failed'), 'error');
          break;
        default:
          break;
      }
    },
    [t],
  );

  const onFileError = useCallback(
    (e: unknown) => {
      showNotice(t(e instanceof ResultGoneError ? 'download.gone' : 'download.failed'), 'error');
    },
    [t],
  );

  const save = useCallback(
    (forceTarget?: SaveTarget) =>
      guarded(async () => {
        if (!forceTarget) trackDownloadClicked(context, descriptor.kind, src.surface);
        lastTarget.current = forceTarget;
        let file;
        try {
          file = await ensureFile();
        } catch (e) {
          return onFileError(e);
        }
        report(
          await saveResult({
            file,
            kind: descriptor.kind,
            fileName: descriptor.fileName,
            mime: descriptor.mime,
            context,
            forceTarget,
            deps: realSaveDeps(),
          }),
        );
      }),
    [guarded, context, descriptor, src.surface, ensureFile, onFileError, report],
  );

  const share = useCallback(
    () =>
      guarded(async () => {
        trackDownloadClicked(context, descriptor.kind, src.surface);
        let file;
        try {
          file = await ensureFile();
        } catch (e) {
          return onFileError(e);
        }
        const out = await shareResult({
          file,
          kind: descriptor.kind,
          mime: descriptor.mime,
          context,
          deps: realSaveDeps(),
        });
        if (out.status === 'failed') showNotice(t('save.shareFailed'), 'error');
      }),
    [guarded, context, descriptor, src.surface, ensureFile, onFileError, t],
  );

  const copyShareLink = useCallback(
    () =>
      guarded(async () => {
        setSheet(null);
        const res = await createAndCopyShareLink(
          descriptor.jobId,
          descriptor.kind,
          context,
          realShareDeps(),
        );
        if (res.status === 'copied') {
          showNotice(
            t('interface:share.copied', { when: formatDateTime(res.expiresAt, 'dateTime') }),
          );
          return;
        }
        const map = {
          not_allowed: 'interface:share.notAllowed',
          unavailable: 'interface:share.expired',
          unauthorized: 'interface:share.signIn',
        } as const;
        if (res.code === 'limit') return setSheet('limit');
        const key = map[res.code as keyof typeof map] ?? 'interface:share.failed';
        showNotice(t(key), 'error');
      }),
    [guarded, descriptor, context, t],
  );

  const revokeLinks = useCallback(
    () =>
      guarded(async () => {
        setSheet(null);
        const res = await revokeAllShareLinks(descriptor.jobId, realShareDeps());
        if (res.status === 'error') return showNotice(t('interface:share.revokeFailed'), 'error');
        showNotice(t(res.count > 0 ? 'interface:share.revoked' : 'interface:share.revokeNone'));
      }),
    [guarded, descriptor, t],
  );

  const downloadMp3 = useCallback(
    () =>
      guarded(async () => {
        setSheet(null);
        trackDownloadClicked(context, descriptor.kind, src.surface);
        setConverting(true);
        const conv = await convertToMp3(
          descriptor.jobId,
          descriptor.fileName,
          context,
          realMp3Deps(),
        );
        setConverting(false);
        if (conv.status === 'skipped') return;
        if (conv.status === 'timeout') return showNotice(t('mp3.stillConverting'), 'error');
        if (conv.status !== 'ready') return showNotice(t('mp3.failed'), 'error');
        let file;
        try {
          setProgress(0);
          file = await downloadResult({
            jobId: descriptor.jobId,
            fileName: conv.fileName,
            sizeBytes: conv.sizeBytes,
            outputFormat: 'mp3',
            context,
            link: conv.link,
            skipStartedEvent: true,
            onProgress: setProgress,
          });
        } catch (e) {
          return onFileError(e);
        }
        report(
          await saveResult({
            file,
            kind: 'audio',
            fileName: conv.fileName,
            mime: 'audio/mpeg',
            context,
            deps: realSaveDeps(),
          }),
        );
      }),
    [guarded, context, descriptor, src.surface, onFileError, report, t],
  );

  const remove = useCallback(
    () =>
      guarded(async () => {
        setSheet(null);
        const res = await deleteResult(descriptor.jobId, context, realDeleteDeps());
        if (res.status === 'failed') return showNotice(t('delete.failed'), 'error');
        showNotice(t(res.pending ? 'delete.pending' : 'delete.done'));
        router.replace(TOOLS_TAB as Href);
      }),
    [guarded, descriptor, context, t],
  );

  const runAnother = useCallback(() => {
    setSheet(null);
    const tool = src.tool;
    if (!tool) return;
    // Re-attach the kept original when its cache copy still exists; otherwise the tool opens empty.
    const original = findOriginal(descriptor.jobId, src.originalName, src.originalMime);
    let intake = '';
    if (original) {
      const ext = extensionOf(original.name);
      const file: IntakeFile = {
        id: `rerun_${descriptor.jobId}`,
        uri: original.uri,
        name: original.name,
        extension: ext,
        mimeType: original.mime ?? src.originalMime,
        mediaKind: tool.kind,
        sizeBytes: sizeOf(original.uri),
        source: 'picker',
        copiedAt: Date.now(),
      };
      setIntakeBatch({ files: [file], rejected: [] });
      intake = `?intake=${encodeURIComponent(file.id)}`;
    }
    router.push(`/(app)/tool/${tool.family}/${tool.id}${intake}` as Href);
  }, [src.tool, src.originalName, src.originalMime, descriptor.jobId]);

  return {
    sheet,
    setSheet,
    progress,
    converting,
    working: progress !== null || converting,
    save,
    share,
    copyShareLink,
    revokeLinks,
    downloadMp3,
    remove,
    runAnother,
    openSettings: () => {
      setSheet(null);
      void Linking.openSettings();
    },
    saveToFilesInstead: () => {
      setSheet(null);
      void save('files');
    },
  };
}
