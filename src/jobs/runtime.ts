import * as Network from 'expo-network';
import { fetch as expoFetch } from 'expo/fetch';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState, Platform } from 'react-native';
import { accountApi } from '@/api/endpoints/account';
import { mmApi } from '@/api/mmApi';
import { copyOriginal, keepOriginal as keepOriginalCopy, releaseIntakeFile } from '@/files/intake';
import { mmkvStorage } from '@/state/persist';
import { jobUpserted } from '@/state/slices/jobs';
import { store } from '@/state/store';
import { File } from 'expo-file-system';
import { makeUploadTask } from './fsTask';
import { createJobEngine, type JobEngine, type JobEngineDeps } from './jobEngine';
import { createJobTransport, type StreamFetch } from './transport';
import { uuidv4 } from '@/lib/ids';
import { makeBeforeUpload } from '@/quota/quotaGuard';
import { trackPhotoExportSettled } from '@/analytics/photoEvents';
import {
  makePhotoExportStarter,
  PHOTO_EXPORT_STARTER,
  rtkExportCall,
} from './starters/photoExport';

const KEEP_AWAKE_TAG = 'mm-upload';
/** MMKV list of Firebase uids already counted (`activation_first_job_completed` once per uid). */
export const ACTIVATED_KEY = 'mm.activated';

export async function claimActivation(
  uid: string,
  storage: Pick<typeof mmkvStorage, 'getItem' | 'setItem'> = mmkvStorage,
): Promise<boolean> {
  let seen: string[] = [];
  try {
    const raw = await storage.getItem(ACTIVATED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) seen = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    seen = [];
  }
  if (seen.includes(uid)) return false;
  await storage.setItem(ACTIVATED_KEY, JSON.stringify([...seen, uid]));
  return true;
}

let engine: JobEngine | null = null;

/** The one engine, built lazily against the real store and native modules. */
export function getJobEngine(): JobEngine {
  if (engine) return engine;
  const dispatch = store.dispatch;
  const transport = createJobTransport({
    dispatch,
    makeTask: makeUploadTask,
    streamFetch: expoFetch as unknown as StreamFetch,
    getSessionId: () => store.getState().session.sessionId,
    platform: Platform.OS,
  });
  const deps: JobEngineDeps = {
    transport,
    store: {
      get: (id) => store.getState().jobs.byLocalId[id],
      all: () => {
        const j = store.getState().jobs;
        return j.order.map((id) => j.byLocalId[id]).filter((r) => r !== undefined);
      },
      put: (r) => void dispatch(jobUpserted(r)),
    },
    now: () => Date.now(),
    appState: {
      current: () => {
        const s = AppState.currentState;
        return s === 'active' || s === 'background' || s === 'inactive' ? s : 'active';
      },
      subscribe: (cb) => {
        const sub = AppState.addEventListener('change', cb);
        return () => sub.remove();
      },
    },
    network: {
      subscribe: (cb) => {
        const sub = Network.addNetworkStateListener((st) => cb(Boolean(st.isConnected)));
        return () => sub.remove();
      },
    },
    // Android has no background upload session; keep the screen on while bytes move.
    keepAwake:
      Platform.OS === 'android'
        ? {
            activate: () => void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined),
            release: () => void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined),
          }
        : undefined,
    files: {
      exists: (uri) => {
        try {
          return new File(uri).exists;
        } catch {
          return false;
        }
      },
      release: releaseIntakeFile,
      keepOriginal: (r) => {
        if (!r.jobId) return;
        if (r.transport === 'starter') {
          if (r.fileUri) copyOriginal({ uri: r.fileUri, name: r.fileName }, r.jobId);
          return;
        }
        keepOriginalCopy(
          {
            id: r.intakeFileId,
            uri: r.fileUri,
            name: r.fileName,
            extension: r.sourceExtension,
            mimeType: r.mimeType,
            mediaKind: r.mediaKind,
            sizeBytes: r.sizeBytes,
            source: 'picker',
            copiedAt: r.createdAt,
          },
          r.jobId,
        );
      },
    },
    onSettled: () => {
      dispatch(mmApi.util.invalidateTags(['Account', 'History']));
    },
    activation: {
      uid: () => store.getState().auth.uid,
      signupAt: () => {
        const created = accountApi.endpoints.getAccountMe.select()(store.getState()).data?.user
          ?.createdAt;
        const ms = created ? Date.parse(created) : NaN;
        return Number.isFinite(ms) ? ms : null;
      },
      claim: claimActivation,
    },
    beforeUpload: makeBeforeUpload(store.getState),
    newId: uuidv4,
    starters: {
      [PHOTO_EXPORT_STARTER]: makePhotoExportStarter(rtkExportCall(dispatch), {
        settled: (r) => trackPhotoExportSettled(r),
      }),
    },
  };
  engine = createJobEngine(deps);
  return engine;
}
