/**
 * One editor session (ticket MA50 decisions 5 and 8), as plain TypeScript over injected calls so the
 * flows are tested without React or the network:
 *
 * - **open from a file**: the editor shows the local decode at once (`newPhotoDoc` at the probed
 *   size), the upload runs in the background (`createProject`), the progress feeds the
 *   "Uploading… 42 %" chip and the project id unlocks Save and Export when it arrives. Edits made
 *   meanwhile ride along in the create body's `doc` and are kept (the server stamps `source`).
 * - **open a project**: `GET` the project, parse the doc with the shared model, offer a newer draft.
 * - **save**: `PUT` with `If-Match: <serverRevision>`; 409 `revision_conflict` returns `conflict`
 *   for the "Keep mine / Load theirs" sheet; Keep mine re-PUTs on the server's revision.
 */
import type { MmError } from '@/api/errors';
import type { PhotoProjectResponse } from '@/api/schemas/photo';
import {
  draftKey,
  localDraftKey,
  readDraft,
  shouldOfferRecovery,
  writeDraft,
  type Draft,
  type DraftStorage,
} from './drafts';
import { conflictRevision, docOf } from './projectsApi';
import { mutate, photoActions, type PhotoStore } from './photoStore';
import { newPhotoDoc, type PhotoDoc } from './photoTypes';

export type UploadStatus =
  | { kind: 'idle' }
  | { kind: 'uploading'; fraction: number }
  | { kind: 'ready' }
  | { kind: 'failed'; error: MmError };

export type SaveResult =
  | { kind: 'saved'; revision: number }
  | { kind: 'conflict'; serverRevision: number }
  | { kind: 'failed'; error: MmError }
  | { kind: 'not_ready' };

export interface SessionApi {
  createProject(
    input: { fileUri: string; mimeType: string; name?: string; doc?: PhotoDoc },
    onProgress: (f: number) => void,
    signal: AbortSignal,
  ): Promise<{ ok: true; response: PhotoProjectResponse } | { ok: false; error: MmError }>;
  getProject(
    id: string,
  ): Promise<{ ok: true; response: PhotoProjectResponse } | { ok: false; error: MmError }>;
  saveProject(input: {
    id: string;
    revision: number;
    doc: PhotoDoc;
    name?: string;
  }): Promise<{ ok: true; response: PhotoProjectResponse } | { ok: false; error: MmError }>;
}

export interface SessionDeps {
  api: SessionApi;
  store: PhotoStore;
  drafts: DraftStorage;
  now(): number;
}

export interface LocalFile {
  intakeId: string;
  uri: string;
  mimeType: string;
  name?: string;
  width: number;
  height: number;
}

export function createSession(deps: SessionDeps) {
  const { api, store } = deps;
  let upload: UploadStatus = { kind: 'idle' };
  let created: PhotoProjectResponse['project'] | null = null;
  const listeners = new Set<() => void>();
  const abort = new AbortController();
  const emit = () => listeners.forEach((l) => l());
  const setUpload = (u: UploadStatus) => {
    upload = u;
    emit();
  };

  /** Starts editing a picked file now; uploads it in the background. Resolves when the upload ends. */
  async function openFile(file: LocalFile): Promise<UploadStatus> {
    const draft = await readDraft(deps.drafts, localDraftKey(file.intakeId));
    store.dispatch(
      photoActions.loaded({
        projectId: null,
        doc: draft?.doc ?? newPhotoDoc(file.width, file.height),
        name: file.name ?? '',
      }),
    );
    return uploadFile(file);
  }

  async function uploadFile(file: LocalFile): Promise<UploadStatus> {
    setUpload({ kind: 'uploading', fraction: 0 });
    const docAtStart = store.getState().doc ?? undefined;
    const res = await api.createProject(
      { fileUri: file.uri, mimeType: file.mimeType, name: file.name, doc: docAtStart },
      (fraction) => setUpload({ kind: 'uploading', fraction }),
      abort.signal,
    );
    if (!res.ok) {
      setUpload({ kind: 'failed', error: res.error });
      return upload;
    }
    created = res.response.project;
    const serverDoc = docOf(res.response);
    const cur = store.getState().doc;
    // The server sanitized the doc and stamped the ingested (EXIF-upright) size: adopt its
    // `source`, keep any edit made while the bytes were moving.
    if (serverDoc.ok && cur) {
      const source = serverDoc.doc.source;
      if (cur.source.width !== source.width || cur.source.height !== source.height) {
        mutate(store, 'source', (d) => ({ ...d, source }));
      }
    }
    store.dispatch(
      photoActions.projectIdSet({ projectId: created.id, serverRevision: created.revision }),
    );
    // An edit after the create started is not on the server yet: stay dirty (Save enabled).
    const edited = docAtStart !== store.getState().doc;
    if (!edited)
      store.dispatch(
        photoActions.saved({
          serverRevision: created.revision,
          atRevision: store.getState().revision,
        }),
      );
    // The pre-upload draft (if any) now belongs to the project.
    const local = await readDraft(deps.drafts, localDraftKey(file.intakeId));
    if (local) {
      await writeDraft(deps.drafts, draftKey(created.id), {
        ...local,
        baseRevision: created.revision,
      }).catch(() => undefined);
      await deps.drafts.removeItem(localDraftKey(file.intakeId)).catch(() => undefined);
    }
    setUpload({ kind: 'ready' });
    return upload;
  }

  /** Opens a saved project. `recovered` is a draft that differs from the server's doc, if any. */
  async function openProject(
    id: string,
  ): Promise<
    | { ok: true; recovered: Draft | null; response: PhotoProjectResponse }
    | { ok: false; error: MmError | string }
  > {
    const res = await api.getProject(id);
    if (!res.ok) return { ok: false, error: res.error };
    const doc = docOf(res.response);
    if (!doc.ok) return { ok: false, error: 'photo_doc_unreadable' };
    created = res.response.project;
    store.dispatch(
      photoActions.loaded({
        projectId: id,
        doc: doc.doc,
        name: created.name,
        serverRevision: created.revision,
      }),
    );
    setUpload({ kind: 'ready' });
    const draft = await readDraft(deps.drafts, draftKey(id));
    return {
      ok: true,
      recovered: shouldOfferRecovery(draft, doc.doc) ? draft : null,
      response: res.response,
    };
  }

  /** Applies a recovered draft (dirty, so Save stays enabled). */
  function recover(draft: Draft) {
    store.dispatch(photoActions.replaced({ doc: draft.doc, dirty: true }));
  }

  async function save(opts: { overrideRevision?: number } = {}): Promise<SaveResult> {
    const s = store.getState();
    if (!s.projectId || !s.doc || s.serverRevision === null) return { kind: 'not_ready' };
    const atRevision = s.revision;
    const res = await api.saveProject({
      id: s.projectId,
      revision: opts.overrideRevision ?? s.serverRevision,
      doc: s.doc,
      name: s.name || undefined,
    });
    if (res.ok) {
      const revision = res.response.project.revision;
      store.dispatch(photoActions.saved({ serverRevision: revision, atRevision }));
      await deps.drafts.removeItem(draftKey(s.projectId)).catch(() => undefined);
      return { kind: 'saved', revision };
    }
    const serverRevision = conflictRevision(res.error);
    if (serverRevision !== null) return { kind: 'conflict', serverRevision };
    return { kind: 'failed', error: res.error };
  }

  /** Conflict sheet, "Keep mine": overwrite on top of the server's revision. */
  const keepMine = (serverRevision: number) => save({ overrideRevision: serverRevision });

  /** Conflict sheet, "Load theirs": the server's doc replaces the local one (no history). */
  async function loadTheirs(): Promise<boolean> {
    const id = store.getState().projectId;
    if (!id) return false;
    const res = await api.getProject(id);
    if (!res.ok) return false;
    const doc = docOf(res.response);
    if (!doc.ok) return false;
    store.dispatch(
      photoActions.replaced({ doc: doc.doc, serverRevision: res.response.project.revision }),
    );
    await deps.drafts.removeItem(draftKey(id)).catch(() => undefined);
    return true;
  }

  return {
    openFile,
    retryUpload: uploadFile,
    openProject,
    recover,
    save,
    keepMine,
    loadTheirs,
    project: () => created,
    upload: () => upload,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose() {
      abort.abort();
      listeners.clear();
    },
  };
}

export type PhotoSession = ReturnType<typeof createSession>;
