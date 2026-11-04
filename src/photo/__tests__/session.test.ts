import type { MmError } from '@/api/errors';
import type { PhotoProjectResponse } from '@/api/schemas/photo';
import { draftKey, localDraftKey, readDraft, writeDraft, type DraftStorage } from '../drafts';
import { upsertAdjustment } from '../layerOps';
import { makePhotoStore, mutate } from '../photoStore';
import { canonicalPhotoDoc, newPhotoDoc, type PhotoDoc } from '../photoTypes';
import { createSession, type SessionApi } from '../session';

const memory = (): DraftStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    setItem: async (k, v) => void map.set(k, v),
    getItem: async (k) => map.get(k),
    removeItem: async (k) => void map.delete(k),
  };
};

const project = (over: Partial<PhotoProjectResponse['project']> = {}) => ({
  id: 'p1',
  name: 'IMG_1',
  revision: 1,
  status: 'ready',
  width: 4032,
  height: 3024,
  ...over,
});
const response = (doc: PhotoDoc, over = {}): PhotoProjectResponse => ({
  project: project(over),
  doc: JSON.parse(canonicalPhotoDoc(doc)),
});
const conflict = (revision: number): MmError => ({
  status: 409,
  code: 'revision_conflict',
  details: { revision },
});
const setEv = (ev: number) => (d: PhotoDoc) =>
  upsertAdjustment(d, 'exposure', (p) => ({ ...p, ev })).doc;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(api: Partial<SessionApi> = {}) {
  const store = makePhotoStore();
  const drafts = memory();
  const calls = { save: [] as { id: string; revision: number }[] };
  const full: SessionApi = {
    createProject:
      api.createProject ??
      (async (i) => ({ ok: true, response: response(i.doc ?? newPhotoDoc(1, 1)) })),
    getProject:
      api.getProject ?? (async () => ({ ok: true, response: response(newPhotoDoc(4032, 3024)) })),
    saveProject:
      api.saveProject ??
      (async (i) => {
        calls.save.push({ id: i.id, revision: i.revision });
        return { ok: true, response: response(i.doc, { revision: i.revision + 1 }) };
      }),
  };
  const session = createSession({ api: full, store, drafts, now: () => 1000 });
  return { store, drafts, session, calls };
}

const file = {
  intakeId: 'i1',
  uri: 'file:///cache/intake/i1/IMG_1.jpg',
  mimeType: 'image/jpeg',
  name: 'IMG_1',
  width: 4032,
  height: 3024,
};

describe('editor session', () => {
  it('edits at once on the local decode; Save unlocks when the project id arrives', async () => {
    const gate = deferred<void>();
    const progress: number[] = [];
    const { store, session } = setup({
      createProject: async (i, onProgress) => {
        onProgress(0.42);
        await gate.promise;
        return { ok: true, response: response(i.doc!) };
      },
    });
    session.subscribe(() => {
      const u = session.upload();
      if (u.kind === 'uploading') progress.push(u.fraction);
    });
    const done = session.openFile(file);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().doc!.source).toMatchObject({ width: 4032, height: 3024 });
    expect(store.getState().projectId).toBeNull();
    expect(await session.save()).toEqual({ kind: 'not_ready' });
    mutate(store, 'exposure', setEv(1)); // editing before the upload finished
    expect(progress).toContain(0.42);
    gate.resolve();
    expect(await done).toEqual({ kind: 'ready' });
    expect(store.getState()).toMatchObject({ projectId: 'p1', serverRevision: 1, dirty: true });
    expect((await session.save()).kind).toBe('saved');
  });

  it('a create with no edits meanwhile is clean (nothing to save)', async () => {
    const { store, session } = setup();
    await session.openFile(file);
    expect(store.getState()).toMatchObject({ projectId: 'p1', dirty: false });
  });

  it('adopts the server-stamped (EXIF-upright) source size', async () => {
    const { store, session } = setup({
      createProject: async (i) => ({
        ok: true,
        response: response({ ...i.doc!, source: { width: 3024, height: 4032, orientation: 1 } }),
      }),
    });
    await session.openFile(file);
    expect(store.getState().doc!.source).toMatchObject({ width: 3024, height: 4032 });
  });

  it('Save sends If-Match with the server revision and records the new one', async () => {
    const { store, session, calls } = setup();
    await session.openFile(file);
    mutate(store, 'exposure', setEv(1));
    expect(await session.save()).toEqual({ kind: 'saved', revision: 2 });
    expect(calls.save).toEqual([{ id: 'p1', revision: 1 }]);
    expect(store.getState()).toMatchObject({ serverRevision: 2, dirty: false });
  });

  it('If-Match 409 -> conflict sheet; Keep mine re-PUTs on the server revision; Load theirs replaces', async () => {
    let call = 0;
    const theirs = setEv(-2)(newPhotoDoc(4032, 3024));
    const saves: number[] = [];
    const { store, session, drafts } = setup({
      saveProject: async (i) => {
        saves.push(i.revision);
        call += 1;
        return call === 1
          ? { ok: false, error: conflict(5) }
          : { ok: true, response: response(i.doc, { revision: 6 }) };
      },
      getProject: async () => ({ ok: true, response: response(theirs, { revision: 5 }) }),
    });
    await session.openFile(file);
    mutate(store, 'exposure', setEv(1));
    const r = await session.save();
    expect(r).toEqual({ kind: 'conflict', serverRevision: 5 });
    expect(await session.keepMine(5)).toEqual({ kind: 'saved', revision: 6 });
    expect(saves).toEqual([1, 5]);

    mutate(store, 'exposure', setEv(3));
    await writeDraft(drafts, draftKey('p1'), {
      doc: store.getState().doc!,
      baseRevision: 6,
      savedAt: 1,
    });
    expect(await session.loadTheirs()).toBe(true);
    expect(store.getState()).toMatchObject({ serverRevision: 5, dirty: false, past: [] });
    expect(store.getState().doc!.layers[0]!.params).toMatchObject({ ev: -2 });
    expect(drafts.map.has(draftKey('p1'))).toBe(false);
  });

  it('opening a project offers a differing draft, and recovering keeps Save enabled', async () => {
    const { store, session, drafts } = setup();
    const draftDoc = setEv(1.5)(newPhotoDoc(4032, 3024));
    await writeDraft(drafts, draftKey('p1'), { doc: draftDoc, baseRevision: 1, savedAt: 1 });
    const r = await session.openProject('p1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recovered).not.toBeNull();
    session.recover(r.recovered!);
    expect(store.getState()).toMatchObject({ dirty: true });
    expect(store.getState().doc!.layers[0]!.params).toMatchObject({ ev: 1.5 });
  });

  it('a pre-upload draft is recovered on reopen and moves to the project key', async () => {
    const { store, session, drafts } = setup();
    await writeDraft(drafts, localDraftKey('i1'), {
      doc: setEv(2)(newPhotoDoc(4032, 3024)),
      baseRevision: null,
      savedAt: 1,
    });
    await session.openFile(file);
    expect(store.getState().doc!.layers[0]!.params).toMatchObject({ ev: 2 });
    expect(drafts.map.has(localDraftKey('i1'))).toBe(false);
    expect((await readDraft(drafts, draftKey('p1')))!.baseRevision).toBe(1);
  });

  it('after an export (which saves the doc server-side) the next Save uses the new revision', async () => {
    const saves: number[] = [];
    const { store, session } = setup({
      getProject: async () => ({
        ok: true,
        response: response(newPhotoDoc(4032, 3024), { revision: 2 }),
      }),
      saveProject: async (i) => {
        saves.push(i.revision);
        return { ok: true, response: response(i.doc, { revision: i.revision + 1 }) };
      },
    });
    await session.openFile(file);
    mutate(store, 'exposure', setEv(1));
    await session.afterExport(store.getState().doc!);
    expect(store.getState()).toMatchObject({ serverRevision: 2, dirty: false });
    mutate(store, 'exposure', setEv(2));
    await session.save();
    expect(saves).toEqual([2]);
  });

  it('a refused upload reports the error (MA16 sheet) and the edits stay', async () => {
    const err: MmError = {
      status: 403,
      code: 'photo_projects_limit',
      details: { limit: 5, used: 5 },
    };
    const { store, session } = setup({ createProject: async () => ({ ok: false, error: err }) });
    const r = await session.openFile(file);
    expect(r).toEqual({ kind: 'failed', error: err });
    expect(store.getState().doc).not.toBeNull();
  });
});
