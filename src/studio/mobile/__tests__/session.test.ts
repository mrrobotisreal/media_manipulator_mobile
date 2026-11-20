import type { MmError } from '@/api/errors';
import { normaliseError } from '@/api/errors';
import { studioFixture } from '../../fixtures/studioFixture';
import type { StudioProject, StudioSaveProjectRequest } from '../../studioTypes';
import {
  DRAFT_MMKV_MAX_CHARS,
  DRAFT_WRITE_THROTTLE_MS,
  readStudioDraft,
  studioDraftFileName,
  studioDraftKey,
  writeStudioDraft,
  type DraftStorage,
} from '../drafts';
import { setClipVolume } from '../edits';
import { AUTOSAVE_DEBOUNCE_MS, createStudioSession, type StudioSessionApi } from '../session';
import { studioConflictOf } from '../sessionApi';
import { makeStudioStore, mutate } from '../studioStore';

const SERVER_AT = '2026-11-05T00:00:00Z';
const project = (over: Partial<StudioProject> = {}): StudioProject => ({
  ...studioFixture(),
  revision: 4,
  updatedAt: SERVER_AT,
  ...over,
});

function memoryStorage() {
  const kv = new Map<string, string>();
  const files = new Map<string, string>();
  const storage: DraftStorage = {
    kv: {
      setItem: async (k, v) => kv.set(k, v),
      getItem: async (k) => kv.get(k) ?? null,
      removeItem: async (k) => kv.delete(k),
    },
    files: {
      write: async (n, t) => void files.set(n, t),
      read: async (n) => files.get(n) ?? null,
      remove: async (n) => void files.delete(n),
    },
  };
  return { kv, files, storage };
}

/** A fake API: one server project; PUTs compare-and-set like `services.StudioRepository`. */
function fakeApi(initial: StudioProject) {
  let server = initial;
  const puts: StudioSaveProjectRequest[] = [];
  let failNext: MmError | null = null;
  const api: StudioSessionApi = {
    getProject: jest.fn(async () => ({ ok: true as const, value: server })),
    saveProject: jest.fn(async ({ body }) => {
      puts.push(body);
      if (failNext) {
        const error = failNext;
        failNext = null;
        return { ok: false as const, error };
      }
      if (body.expectedRevision !== undefined && body.expectedRevision !== server.revision) {
        return {
          ok: false as const,
          error: normaliseError(409, {
            error: 'revision_conflict',
            currentRevision: server.revision,
            updatedAt: server.updatedAt,
          }),
        };
      }
      server = {
        ...server,
        tracks: body.tracks,
        revision: (server.revision ?? 0) + 1,
        updatedAt: '2026-11-06T00:00:00Z',
      };
      return { ok: true as const, value: server };
    }),
  };
  return {
    api,
    puts,
    server: () => server,
    /** Another device saves first. */
    saveElsewhere(p: Partial<StudioProject>) {
      server = {
        ...server,
        ...p,
        revision: (server.revision ?? 0) + 1,
        updatedAt: '2026-11-07T00:00:00Z',
      };
    },
    failNextWith(e: MmError) {
      failNext = e;
    },
  };
}

const flushMicro = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setup(initial = project()) {
  const store = makeStudioStore();
  const mem = memoryStorage();
  const fake = fakeApi(initial);
  let online = true;
  const session = createStudioSession({
    api: fake.api,
    store,
    drafts: mem.storage,
    now: () => Date.parse('2026-11-08T00:00:00Z'),
    isOnline: () => online,
  });
  return { store, mem, fake, session, setOnline: (v: boolean) => (online = v) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('studio session: open and autosave', () => {
  it('opens a project normalized, clean and saved', async () => {
    const { session, store } = setup();
    const r = await session.open('proj-1');
    expect(r).toEqual({ ok: true, draft: null, decision: null });
    expect(store.getState()).toMatchObject({
      projectId: 'proj-1',
      serverRevision: 4,
      dirty: false,
    });
    expect(session.saveState().state).toBe('saved');
  });

  it('autosaves 1.2 s after the LAST edit with the web save body and expectedRevision', async () => {
    const { session, store, fake } = setup();
    await session.open('proj-1');
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 100);
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.6));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(fake.puts).toHaveLength(0);
    expect(session.saveState().state).toBe('saving');
    jest.advanceTimersByTime(1);
    await flushMicro();
    expect(fake.puts).toHaveLength(1);
    const body = fake.puts[0]!;
    expect(body.expectedRevision).toBe(4);
    expect(body.schemaVersion).toBe(3);
    expect(Object.keys(body).sort()).toEqual(
      [
        'audio',
        'captionStyle',
        'captions',
        'captionsEnabled',
        'expectedRevision',
        'fps',
        'height',
        'markers',
        'name',
        'schemaVersion',
        'tracks',
        'width',
      ].sort(),
    );
    expect(store.getState()).toMatchObject({ dirty: false, serverRevision: 5 });
    expect(session.saveState().state).toBe('saved');
  });

  it('waits for a drag to end before saving', async () => {
    const { session, store, fake } = setup();
    await session.open('proj-1');
    store.dispatch({ type: 'studio/gestureBegan', payload: 'Volume' });
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 3);
    await flushMicro();
    expect(fake.puts).toHaveLength(0);
    store.dispatch({ type: 'studio/gestureEnded' });
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(fake.puts).toHaveLength(1);
  });

  it('a network failure retries with the copied saveState backoff; a 400 parks in failed', async () => {
    const { session, store, fake } = setup();
    await session.open('proj-1');
    fake.failNextWith({ status: 'FETCH_ERROR', code: 'network', details: {} });
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(session.saveState()).toMatchObject({ state: 'retrying', nextRetryDelayMs: 1200 });
    jest.advanceTimersByTime(1200);
    await flushMicro();
    expect(fake.puts).toHaveLength(2);
    expect(session.saveState().state).toBe('saved');

    fake.failNextWith(normaliseError(400, { error: 'Invalid request body' }));
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.7));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(session.saveState().state).toBe('failed');
    jest.advanceTimersByTime(60_000);
    expect(fake.puts).toHaveLength(3);
  });

  it('offline waits for reconnect instead of burning retries', async () => {
    const { session, store, fake, setOnline } = setup();
    await session.open('proj-1');
    setOnline(false);
    fake.failNextWith({ status: 'FETCH_ERROR', code: 'network', details: {} });
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(session.saveState().state).toBe('offline');
    jest.advanceTimersByTime(120_000);
    expect(fake.puts).toHaveLength(1);
    setOnline(true);
    session.setOnline(true);
    jest.advanceTimersByTime(0);
    await flushMicro();
    expect(fake.puts).toHaveLength(2);
    expect(session.saveState().state).toBe('saved');
  });
});

describe('studio session: 409 revision_conflict', () => {
  it('normalises the API 409 body into a conflict with currentRevision', () => {
    const e = normaliseError(409, {
      error: 'revision_conflict',
      currentRevision: 9,
      updatedAt: '2026-11-07T00:00:00Z',
    });
    expect(studioConflictOf(e)).toEqual({ currentRevision: 9, updatedAt: '2026-11-07T00:00:00Z' });
    expect(studioConflictOf(normaliseError(409, {}))).toBeNull();
  });

  it('409 -> conflict sheet state; autosave blocked; Keep mine re-sends with currentRevision', async () => {
    const { session, store, fake } = setup();
    await session.open('proj-1');
    fake.saveElsewhere({ name: 'Renamed on the web' }); // server is now revision 5
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(session.saveState().state).toBe('conflict');
    expect(session.conflict()).toEqual({ currentRevision: 5, updatedAt: '2026-11-07T00:00:00Z' });

    // While the sheet is open, further edits never autosave.
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.6));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 5);
    await flushMicro();
    expect(fake.puts).toHaveLength(1);

    const p = session.keepMine();
    await flushMicro();
    expect(await p).toBe(true);
    expect(fake.puts[1]!.expectedRevision).toBe(5);
    expect(fake.server().revision).toBe(6);
    expect(store.getState()).toMatchObject({ dirty: false, serverRevision: 6 });
    expect(session.conflict()).toBeNull();
    expect(session.saveState().state).toBe('saved');
  });

  it('Load theirs replaces the doc with the server copy, clean and without history', async () => {
    const { session, store, fake, mem } = setup();
    await session.open('proj-1');
    fake.saveElsewhere({ name: 'Renamed on the web' });
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(mem.kv.has(studioDraftKey('proj-1'))).toBe(true); // flushed when the 409 landed
    expect(await session.loadTheirs()).toBe(true);
    const s = store.getState();
    expect(s.doc?.name).toBe('Renamed on the web');
    expect(s).toMatchObject({ dirty: false, serverRevision: 5, past: [] });
    expect(mem.kv.has(studioDraftKey('proj-1'))).toBe(false);
    expect(session.saveState().state).toBe('saved');
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(fake.puts).toHaveLength(1);
  });
});

describe('studio drafts', () => {
  it('writes the dirty doc under studioDraft:<id> every 3 s and deletes it after a save', async () => {
    const { session, store, mem, fake } = setup();
    await session.open('proj-1');
    fake.failNextWith(normaliseError(400, {}));
    mutate(store, 'v', (d) => setClipVolume(d, 'clipA', 0.5));
    jest.advanceTimersByTime(DRAFT_WRITE_THROTTLE_MS - 1);
    await flushMicro();
    expect(mem.kv.has(studioDraftKey('proj-1'))).toBe(false);
    jest.advanceTimersByTime(1);
    await flushMicro();
    const draft = await readStudioDraft(mem.storage, 'proj-1');
    expect(draft?.baseRevision).toBe(4);
    expect(draft?.document.tracks[0]!.clips[0]!.volume).toBe(0.5);
    expect(session.hasUnsafeWork()).toBe(false);

    await session.save();
    expect(mem.kv.has(studioDraftKey('proj-1'))).toBe(false);
  });

  it('reopen offers recovery for a newer draft on the same revision', async () => {
    const { session, mem, store, fake } = setup();
    const edited = project();
    edited.tracks[0]!.clips[0] = { ...edited.tracks[0]!.clips[0]!, volume: 0.3 };
    await writeStudioDraft(mem.storage, {
      projectId: 'proj-1',
      baseRevision: 4,
      savedAt: Date.parse(SERVER_AT) + 60_000,
      document: edited,
    });
    const r = await session.open('proj-1');
    expect(r.ok && r.decision).toBe('recover');
    if (!r.ok || !r.draft) throw new Error('no draft');
    session.recover(r.draft);
    // The recovered doc is dirty, so autosave persists it.
    expect(store.getState().dirty).toBe(true);
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushMicro();
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0]!.tracks[0]!.clips[0]!.volume).toBe(0.3);
  });

  it('a draft taken on an older revision is the conflict variant; one equal to the server is dropped', async () => {
    const a = setup(project({ revision: 6 }));
    const edited = project();
    edited.tracks[0]!.clips[0] = { ...edited.tracks[0]!.clips[0]!, volume: 0.3 };
    await writeStudioDraft(a.mem.storage, {
      projectId: 'proj-1',
      baseRevision: 4,
      savedAt: Date.parse(SERVER_AT) + 60_000,
      document: edited,
    });
    const r = await a.session.open('proj-1');
    expect(r.ok && r.decision).toBe('conflict');

    const b = setup();
    await writeStudioDraft(b.mem.storage, {
      projectId: 'proj-1',
      baseRevision: 4,
      savedAt: Date.parse(SERVER_AT) + 60_000,
      document: project(),
    });
    const r2 = await b.session.open('proj-1');
    expect(r2).toEqual({ ok: true, draft: null, decision: 'discard' });
    expect(b.mem.kv.has(studioDraftKey('proj-1'))).toBe(false);
  });

  it('an EDL over 2 MB goes to a document-dir file; MMKV keeps only the pointer', async () => {
    const mem = memoryStorage();
    const big = project();
    const clips = Array.from({ length: 20_000 }, (_, i) => ({
      id: `c${i}`,
      assetId: 'beach',
      streamIndex: 0,
      timelineStart: i * 2,
      sourceIn: 0,
      sourceOut: 2,
      volume: 1,
      opacity: 1,
    }));
    big.tracks[0] = { ...big.tracks[0]!, clips };
    expect(JSON.stringify(big).length).toBeGreaterThan(DRAFT_MMKV_MAX_CHARS);
    await writeStudioDraft(mem.storage, {
      projectId: 'proj-1',
      baseRevision: 4,
      savedAt: 1,
      document: big,
    });
    const pointer = mem.kv.get(studioDraftKey('proj-1'))!;
    expect(pointer.length).toBeLessThan(500);
    expect(JSON.parse(pointer).file).toBe(studioDraftFileName('proj-1'));
    const back = await readStudioDraft(mem.storage, 'proj-1');
    expect(back?.document.tracks[0]!.clips).toHaveLength(20_000);

    // A later small draft moves back into MMKV and removes the file.
    await writeStudioDraft(mem.storage, {
      projectId: 'proj-1',
      baseRevision: 4,
      savedAt: 2,
      document: project(),
    });
    expect(mem.files.size).toBe(0);
    expect((await readStudioDraft(mem.storage, 'proj-1'))?.savedAt).toBe(2);
  });

  it('a corrupt or foreign draft reads as no draft', async () => {
    const mem = memoryStorage();
    mem.kv.set(studioDraftKey('p'), '{not json');
    expect(await readStudioDraft(mem.storage, 'p')).toBeNull();
    mem.kv.set(studioDraftKey('p'), JSON.stringify({ v: 1, projectId: 'other', doc: '{}' }));
    expect(await readStudioDraft(mem.storage, 'p')).toBeNull();
    mem.kv.set(studioDraftKey('p'), JSON.stringify({ v: 1, projectId: 'p', file: 'gone.json' }));
    expect(await readStudioDraft(mem.storage, 'p')).toBeNull();
  });
});
