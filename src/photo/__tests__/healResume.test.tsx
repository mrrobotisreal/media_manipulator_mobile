/**
 * MA56: a heal in flight survives backgrounding and an app kill, and a `photo_heal` push tap opens
 * its project in the editor, which installs it. Flow tests over the real workspace hook with a
 * fake fetch, an in-memory key-value store (MMKV in the app) and a scripted AppState.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SkImage } from '@shopify/react-native-skia';
import { AppState, type AppStateStatus } from 'react-native';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { createPushHandlers, jobHref, type HandlerDeps } from '@/push/handlers';
import type { RemoteMessage } from '@/push/messaging';
import type { AiDeps } from '../aiApi';
import {
  HEAL_JOBS_KEY,
  pendingHealKey,
  readPendingHeal,
  resolveHealProject,
  savePendingHeal,
  type HealKv,
  type PendingHeal,
} from '../healPending';
import { editorHref } from '../openRequest';
import { makePhotoStore, photoActions, type PhotoStore } from '../photoStore';
import { newPhotoDoc, parsePhotoDoc, type PhotoDoc } from '../photoTypes';
import type { SkiaApi } from '../skia/shaderChain';
import { useEditorWorkspace, type WorkspaceIo } from '../ui/useEditorWorkspace';

jest.mock('@/analytics/track', () => ({ track: jest.fn(), setContext: jest.fn() }));
const trackMock = track as jest.Mock;

const PID = '0b5e3c1a-7d2f-4c8e-9a6b-1f2e3d4c5b6a';
const JOB = '3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c';
const HASH = 'a'.repeat(64);
const done = {
  id: JOB,
  status: 'completed',
  options: { tool: 'photo_heal', projectId: PID, base: '' },
  healResult: {
    baseHash: HASH,
    baseRef: `bases/${HASH}.png`,
    proxyRef: `bases/${HASH}.proxy.jpg`,
    maskRef: 'masks/heal-0123456789abcdef.png',
    width: 4000,
    height: 3000,
  },
};

function memoryKv() {
  const m = new Map<string, string>();
  const kv: HealKv = {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
  return { kv, m };
}

/** The server: `state` decides what `GET /job/:id` answers; the heal POST returns JOB. */
function fakeServer() {
  const s = { state: 'processing' as 'processing' | 'completed' | 'failed', polls: 0, posts: 0 };
  const ai: AiDeps = {
    baseUrl: 'https://api.test/api',
    headers: async () => ({ Authorization: 'Bearer t' }),
    fetch: async (url) => {
      if (!url.endsWith(`/job/${JOB}`)) throw new Error(`unexpected ${url}`);
      s.polls += 1;
      const body =
        s.state === 'completed'
          ? done
          : s.state === 'failed'
            ? { id: JOB, status: 'failed', error: 'boom' }
            : { id: JOB, status: 'processing', progress: 40 };
      return { status: 200, headers: {}, text: async () => JSON.stringify(body) };
    },
    upload: async () => {
      s.posts += 1;
      return { status: 202, headers: {}, body: JSON.stringify({ jobId: JOB }) };
    },
    download: async (_u, dest) => dest,
    sleep: () => new Promise((r) => setTimeout(r, 2)),
  };
  return { s, ai };
}

let listeners: ((s: AppStateStatus) => void)[] = [];
const setAppState = async (st: AppStateStatus) =>
  act(async () => {
    Object.defineProperty(AppState, 'currentState', { value: st, configurable: true });
    for (const l of [...listeners]) l(st);
  });

beforeEach(() => {
  trackMock.mockClear();
  listeners = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    listeners.push(cb as (s: AppStateStatus) => void);
    return {
      remove: () => (listeners = listeners.filter((l) => l !== cb)),
    } as never;
  });
});
afterEach(() => jest.restoreAllMocks());

function doc(over: Partial<PhotoDoc> = {}): PhotoDoc {
  const r = parsePhotoDoc({ ...newPhotoDoc(4000, 3000), ...over });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

function setup(o: { kv: HealKv; ai: AiDeps; store?: PhotoStore; projectId?: string }) {
  const store = o.store ?? makePhotoStore();
  if (!o.store) store.dispatch(photoActions.loaded({ projectId: PID, doc: doc() }));
  const baseImage = jest.fn(
    async () => ({ width: () => 4000, height: () => 3000 }) as unknown as SkImage,
  );
  const io: WorkspaceIo = {
    ai: o.ai,
    subjectBytes: async () => null,
    baseImage,
    writeMask: async () => 'file:///cache/mask.png',
    renderHealMask: () => new Uint8Array([1]),
    pending: o.kv,
    now: () => 1_000_000,
  };
  const onLimit = jest.fn(() => false);
  const props = {
    api: {} as SkiaApi,
    io,
    store,
    original: null,
    projectId: o.projectId ?? PID,
    capabilities: { aiMasks: true, heal: true },
    onLimit,
    onNotice: jest.fn(),
  };
  return { store, baseImage, props };
}

const events = (name: string) => trackMock.mock.calls.filter((c) => c[0] === name);

describe('MA56 heal resume', () => {
  it('persists the pending heal, stops polling in the background and installs it once on the foreground', async () => {
    const { kv, m } = memoryKv();
    const { s, ai } = fakeServer();
    const { store, baseImage, props } = setup({ kv, ai });
    const { result } = await renderHook(() => useEditorWorkspace(props));

    result.current.healStrokes.push({ pts: [{ x: 0.5, y: 0.5 }], size: 20 });
    let pressed: Promise<void> = Promise.resolve();
    await act(async () => {
      pressed = result.current.extra.heal!();
    });
    await waitFor(() => expect(s.polls).toBeGreaterThan(0));
    // Persisted before the poll, keyed by project; the job index maps the job to its project.
    const rec = await readPendingHeal(kv, PID, 1_000_000);
    expect(rec).toEqual({ jobId: JOB, projectId: PID, base: '', startedAt: 1_000_000 });
    expect(JSON.parse(m.get(HEAL_JOBS_KEY)!)).toEqual({ [JOB]: PID });
    expect(result.current.extra.healState?.phase).toBe('running');

    await setAppState('background');
    await act(async () => pressed);
    const polled = s.polls;
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(s.polls).toBe(polled); // no polling while backgrounded: the API's push fires
    expect(m.has(pendingHealKey(PID))).toBe(true);
    expect(store.getState().doc!.heals).toEqual([]);

    s.state = 'completed';
    await setAppState('active');
    await setAppState('active'); // a second foreground must not start a second install
    await waitFor(() => expect(store.getState().doc!.heals).toHaveLength(1));
    expect(store.getState().doc!.heals[0]).toMatchObject({ baseRef: `bases/${HASH}.png` });
    expect(baseImage).toHaveBeenCalledTimes(1);
    expect(m.has(pendingHealKey(PID))).toBe(false);
    expect(m.has(HEAL_JOBS_KEY)).toBe(false);
    expect(result.current.extra.healState?.phase).toBe('idle');
    expect(result.current.healStrokes).toHaveLength(0);
    expect(events(EVENTS.PHOTO_HEAL_REQUESTED)).toHaveLength(1);
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(1);
    expect(events(EVENTS.PHOTO_HEAL_FAILED)).toHaveLength(0);

    await setAppState('background');
    await setAppState('active');
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(store.getState().doc!.heals).toHaveLength(1);
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(1);
  });

  it('backgrounded while the heal POST is in flight: no background poll, resumed on the foreground', async () => {
    const { kv } = memoryKv();
    const { s, ai } = fakeServer();
    const upload = ai.upload;
    ai.upload = async (...a) => {
      Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
      return upload(...a);
    };
    const { store, props } = setup({ kv, ai });
    const { result } = await renderHook(() => useEditorWorkspace(props));
    result.current.healStrokes.push({ pts: [{ x: 0.5, y: 0.5 }], size: 20 });
    await act(async () => result.current.extra.heal!());
    expect(s.posts).toBe(1);
    expect(s.polls).toBe(0);
    expect((await readPendingHeal(kv, PID, 1_000_000))?.jobId).toBe(JOB);
    s.state = 'completed';
    await setAppState('active');
    await waitFor(() => expect(store.getState().doc!.heals).toHaveLength(1));
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(1);
  });

  it('a pending heal persisted before an app kill resumes when the project opens', async () => {
    const { kv, m } = memoryKv();
    const { s, ai } = fakeServer();
    s.state = 'completed';
    await savePendingHeal(kv, {
      jobId: JOB,
      projectId: PID,
      base: '',
      startedAt: 1_000_000 - 150_000,
      slug: 'aperture',
    });
    // Cold start: the editor mounts before the project's doc arrives.
    const store = makePhotoStore();
    const { props } = setup({ kv, ai, store });
    await renderHook(() => useEditorWorkspace(props));
    expect(s.polls).toBe(0);
    await act(async () => {
      store.dispatch(photoActions.loaded({ projectId: PID, doc: doc() }));
    });
    await waitFor(() => expect(store.getState().doc!.heals).toHaveLength(1));
    expect(m.has(pendingHealKey(PID))).toBe(false);
    const completed = events(EVENTS.PHOTO_HEAL_COMPLETED);
    expect(completed).toHaveLength(1);
    expect(completed[0]![2]).toEqual({ tool_slug: 'aperture', feature: 'photo' });
  });

  it('a failed job clears the record, reports photo_heal_failed and changes nothing', async () => {
    const { kv, m } = memoryKv();
    const { s, ai } = fakeServer();
    s.state = 'failed';
    await savePendingHeal(kv, { jobId: JOB, projectId: PID, base: '', startedAt: 1_000_000 });
    const { store, props } = setup({ kv, ai });
    const { result } = await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(result.current.extra.healState?.phase).toBe('failed'));
    expect(m.has(pendingHealKey(PID))).toBe(false);
    expect(store.getState().doc!.heals).toEqual([]);
    expect(events(EVENTS.PHOTO_HEAL_FAILED)).toHaveLength(1);
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(0);
  });

  it('a heal already in the doc (installed and saved before a kill) is cleared, not installed twice', async () => {
    const { kv, m } = memoryKv();
    const { s, ai } = fakeServer();
    s.state = 'completed';
    await savePendingHeal(kv, { jobId: JOB, projectId: PID, base: '', startedAt: 1_000_000 });
    const store = makePhotoStore();
    store.dispatch(
      photoActions.loaded({
        projectId: PID,
        doc: doc({
          heals: [{ id: 'heal-1', baseRef: `bases/${HASH}.png`, maskRef: done.healResult.maskRef }],
        }),
      }),
    );
    const { baseImage, props } = setup({ kv, ai, store });
    await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(m.has(pendingHealKey(PID))).toBe(false));
    expect(store.getState().doc!.heals).toHaveLength(1);
    expect(baseImage).not.toHaveBeenCalled();
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(0);
  });

  it('two editors on the same project: only the newest installs', async () => {
    const { kv } = memoryKv();
    const { s, ai } = fakeServer();
    await savePendingHeal(kv, { jobId: JOB, projectId: PID, base: '', startedAt: 1_000_000 });
    const a = setup({ kv, ai });
    await renderHook(() => useEditorWorkspace(a.props));
    const b = setup({ kv, ai });
    await renderHook(() => useEditorWorkspace(b.props));
    s.state = 'completed';
    await setAppState('active');
    await waitFor(() => expect(b.store.getState().doc!.heals).toHaveLength(1));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(a.store.getState().doc!.heals).toHaveLength(0);
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(1);
  });
});

describe('MA56 photo_heal push tap', () => {
  const msg = (tool: string) =>
    ({
      data: { jobId: JOB, tool, status: 'completed', url: `mediamanipulator://job/${JOB}` },
    }) as unknown as RemoteMessage;

  function handlers(kv: HealKv, opts: { currentPhoto?: string | null; options?: object } = {}) {
    const fetchJob = jest.fn(async () => ({ options: { ...(opts.options ?? {}) } }));
    const deps = {
      currentJobId: () => null,
      showToast: jest.fn(),
      refresh: jest.fn(),
      route: jest.fn(),
      trackOpened: jest.fn(),
      healProject: (id: string) => resolveHealProject(kv, id, fetchJob),
      currentPhotoProjectId: () => opts.currentPhoto ?? null,
    } satisfies HandlerDeps;
    return { deps, fetchJob, h: createPushHandlers(deps) };
  }

  it('routes to the editor for that project, which resumes and installs the result', async () => {
    const { kv, m } = memoryKv();
    await savePendingHeal(kv, { jobId: JOB, projectId: PID, base: '', startedAt: 1_000_000 });
    const { deps, fetchJob, h } = handlers(kv);
    h.onOpened(msg('photo_heal'), 'background');
    await waitFor(() => expect(deps.route).toHaveBeenCalledWith(editorHref(PID)));
    expect(fetchJob).not.toHaveBeenCalled(); // the local index answered
    expect(deps.trackOpened).toHaveBeenCalledWith({
      jobId: JOB,
      tool: 'photo_heal',
      status: 'completed',
      app_state: 'background',
    });

    // The route mounts the editor for the project; the finished job is installed.
    const { s, ai } = fakeServer();
    s.state = 'completed';
    const { store, props } = setup({ kv, ai });
    await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(store.getState().doc!.heals).toHaveLength(1));
    expect(m.has(pendingHealKey(PID))).toBe(false);
    expect(events(EVENTS.PHOTO_HEAL_COMPLETED)).toHaveLength(1);
  });

  it("without a local record, uses the job's options.projectId (quit-state tap)", async () => {
    const { kv } = memoryKv();
    const { deps, fetchJob, h } = handlers(kv, {
      options: { tool: 'photo_heal', projectId: PID, base: '' },
    });
    h.onOpened(msg('photo_heal'), 'quit');
    await waitFor(() => expect(deps.route).toHaveBeenCalledWith(editorHref(PID)));
    expect(fetchJob).toHaveBeenCalledWith(JOB);
  });

  it('does not route when that editor is already open (it resumes on the foreground)', async () => {
    const { kv } = memoryKv();
    await savePendingHeal(kv, { jobId: JOB, projectId: PID, base: '', startedAt: 1_000_000 });
    const { deps, h } = handlers(kv, { currentPhoto: PID });
    h.onOpened(msg('photo_heal'), 'background');
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(deps.route).not.toHaveBeenCalled();
    // In the foreground on that editor: no toast either.
    h.onForeground(msg('photo_heal'));
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it('falls back to the job screen when the project cannot be resolved; other tools unchanged', async () => {
    const { kv } = memoryKv();
    const a = handlers(kv, { options: {} });
    a.h.onOpened(msg('photo_heal'), 'background');
    await waitFor(() => expect(a.deps.route).toHaveBeenCalledWith(jobHref(JOB)));
    const b = handlers(kv);
    b.h.onOpened(msg('ai_upscale'), 'background');
    expect(b.deps.route).toHaveBeenCalledWith(jobHref(JOB));
  });
});

describe('MA56 pending heal store', () => {
  it('one record per project; a new heal replaces the old one in the job index; junk and stale records drop', async () => {
    const { kv, m } = memoryKv();
    const rec: PendingHeal = { jobId: 'j1', projectId: PID, base: '', startedAt: 1 };
    await savePendingHeal(kv, rec);
    await savePendingHeal(kv, { ...rec, jobId: 'j2' });
    expect(JSON.parse(m.get(HEAL_JOBS_KEY)!)).toEqual({ j2: PID });
    expect((await readPendingHeal(kv, PID, 2))?.jobId).toBe('j2');
    expect(await readPendingHeal(kv, PID, 1 + 25 * 60 * 60_000)).toBeNull();
    expect(m.size).toBe(0);
    m.set(pendingHealKey(PID), '{"jobId":"../x"}');
    expect(await readPendingHeal(kv, PID)).toBeNull();
    expect(m.has(pendingHealKey(PID))).toBe(false);
  });
});
