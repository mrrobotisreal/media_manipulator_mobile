/**
 * The Darkroom editor state on the phone (ticket MA61 decision 3; ADR ui/0001 snapshot undo).
 *
 * A Redux reducer in its own store, like Aperture's `photoStore`: never in component state, never in
 * the persisted app store (an EDL with 1,000 clips at every drag tick does not belong in
 * redux-persist). It ports the web's `lib/studioStore.ts` history semantics, not its 2.5k lines of
 * actions:
 *
 * - every document edit is `mutate(store, label, fn)`, where `fn` is one of the copied web ops
 *   (`edits.ts` wraps `timelineOps`, `proTrim`, `speed`, `looks`, …); documents are immutable and
 *   structurally shared, so an undo snapshot is one pointer;
 * - a drag runs inside `beginGesture` / `endGesture` and lands as ONE undo entry;
 * - the undo cap is 50 (the web's 100, halved for phone memory; proposed in DARKROOM_MOBILE.md §4);
 * - selection and playhead never enter history (undo must not teleport the playhead);
 * - a recipe that would change a locked track is dropped whole (the web's `lockedViolation`).
 *
 * `revision` is the local change counter (drafts and autosave debounce on it); `serverRevision` is
 * the server's compare-and-set token, sent as `expectedRevision` on save.
 */
import {
  configureStore,
  createAction,
  type PayloadAction,
  type UnknownAction,
} from '@reduxjs/toolkit';
import { ensureBaseTracks } from '../timelineOps';
import { normalizeProject, type StudioAsset, type StudioProject } from '../studioTypes';

export const STUDIO_HISTORY_CAP = 50;

export interface StudioHistoryEntry {
  doc: StudioProject;
  label: string;
}

export interface StudioState {
  projectId: string | null;
  doc: StudioProject | null;
  /** Bin entries by asset id (server state, never undone, never saved). */
  assets: Record<string, StudioAsset>;
  /** Selected clip ids (web: `selectedClipIds`). */
  selection: string[];
  /** Timeline seconds. */
  playhead: number;
  past: StudioHistoryEntry[];
  future: StudioHistoryEntry[];
  gestureDepth: number;
  gestureBase: StudioProject | null;
  gestureLabel: string;
  /** Bumped on every document change (drafts and autosave debounce on it). */
  revision: number;
  /** The doc differs from the last saved/loaded one. */
  dirty: boolean;
  /** The server revision the doc is based on (`expectedRevision`); null when the API gave none. */
  serverRevision: number | null;
  /** A recipe was refused because it touched a locked track (the UI shows a notice per `seq`). */
  lockNotice: { trackId: string; seq: number } | null;
}

export const initialStudioState = (): StudioState => ({
  projectId: null,
  doc: null,
  assets: {},
  selection: [],
  playhead: 0,
  past: [],
  future: [],
  gestureDepth: 0,
  gestureBase: null,
  gestureLabel: '',
  revision: 0,
  dirty: false,
  serverRevision: null,
  lockNotice: null,
});

/** What the editor holds after a load: the web's `loadProject` (normalize v1→v3, base tracks). */
export function prepareProject(project: StudioProject): StudioProject {
  const normalized = normalizeProject(project);
  const tracks = ensureBaseTracks(normalized.tracks ?? []);
  // ensureBaseTracks copies the array; keep the reference when nothing was added.
  return tracks.length === normalized.tracks.length ? normalized : { ...normalized, tracks };
}

/**
 * Port of the web store's `lockedViolation`: the id of the first locked track whose clips the
 * edit changed or removed, or null.
 */
export function lockedViolation(before: StudioProject, after: StudioProject): string | null {
  if (before.tracks === after.tracks) return null;
  for (const tr of before.tracks) {
    if (!tr.locked) continue;
    const next = after.tracks.find((t) => t.id === tr.id);
    if (!next) return tr.id;
    if (next.clips === tr.clips) continue;
    if (next.clips.length !== tr.clips.length || next.clips.some((c, i) => c !== tr.clips[i]))
      return tr.id;
  }
  return null;
}

function pushPast(past: StudioHistoryEntry[], entry: StudioHistoryEntry): StudioHistoryEntry[] {
  const next = [...past, entry];
  return next.length > STUDIO_HISTORY_CAP ? next.slice(next.length - STUDIO_HISTORY_CAP) : next;
}

function pruneSelection(ids: string[], doc: StudioProject): string[] {
  if (ids.length === 0) return ids;
  const alive = new Set<string>();
  for (const track of doc.tracks) for (const c of track.clips) alive.add(c.id);
  const kept = ids.filter((id) => alive.has(id));
  return kept.length === ids.length ? ids : kept;
}

// A plain reducer, deliberately not `createSlice`: Immer would wrap every stored doc in a draft and
// freeze copies, so `next === s.doc` (no-op edits) and one-pointer snapshots would stop holding.
// Each case returns the same object when nothing changes.
type Handlers = { [K in keyof Payloads]: (s: StudioState, payload: Payloads[K]) => StudioState };
interface Payloads {
  loaded: { projectId: string; doc: StudioProject; serverRevision?: number | null };
  closed: void;
  edited: { next: StudioProject; label: string; selection?: string[] };
  undone: void;
  redone: void;
  gestureBegan: string;
  gestureEnded: void;
  selected: string[];
  playheadSet: number;
  saved: { serverRevision: number | null; atRevision: number; updatedAt?: string };
  replaced: { doc: StudioProject; serverRevision?: number | null; dirty?: boolean };
  serverRevisionSet: number;
  assetsSet: StudioAsset[];
  assetUpserted: StudioAsset;
}

const handlers: Handlers = {
  loaded: (s, p) => ({
    ...initialStudioState(),
    projectId: p.projectId,
    doc: prepareProject(p.doc),
    serverRevision: p.serverRevision ?? p.doc.revision ?? null,
    revision: s.revision + 1,
  }),
  closed: () => initialStudioState(),
  edited: (s, { next, label, selection }) => {
    if (!s.doc) return s;
    if (next === s.doc) {
      if (selection === undefined) return s;
      const sel = pruneSelection(selection, s.doc);
      return sel === s.selection ? s : { ...s, selection: sel };
    }
    const blocked = lockedViolation(s.doc, next);
    if (blocked)
      return { ...s, lockNotice: { trackId: blocked, seq: (s.lockNotice?.seq ?? 0) + 1 } };
    const view = {
      doc: next,
      selection: pruneSelection(selection ?? s.selection, next),
      revision: s.revision + 1,
      dirty: true,
    };
    if (s.gestureDepth > 0) return { ...s, ...view };
    return { ...s, ...view, past: pushPast(s.past, { doc: s.doc, label }), future: [] };
  },
  undone: (s) => {
    if (s.gestureDepth > 0 || !s.doc || s.past.length === 0) return s;
    const entry = s.past[s.past.length - 1]!;
    return {
      ...s,
      doc: entry.doc,
      past: s.past.slice(0, -1),
      future: [...s.future, { doc: s.doc, label: entry.label }],
      selection: pruneSelection(s.selection, entry.doc),
      revision: s.revision + 1,
      dirty: true,
    };
  },
  redone: (s) => {
    if (s.gestureDepth > 0 || !s.doc || s.future.length === 0) return s;
    const entry = s.future[s.future.length - 1]!;
    return {
      ...s,
      doc: entry.doc,
      past: pushPast(s.past, { doc: s.doc, label: entry.label }),
      future: s.future.slice(0, -1),
      selection: pruneSelection(s.selection, entry.doc),
      revision: s.revision + 1,
      dirty: true,
    };
  },
  gestureBegan: (s, label) =>
    s.gestureDepth === 0
      ? { ...s, gestureDepth: 1, gestureBase: s.doc, gestureLabel: label }
      : { ...s, gestureDepth: s.gestureDepth + 1 },
  gestureEnded: (s) => {
    if (s.gestureDepth === 0) return s; // unbalanced end: tolerated, like the web
    if (s.gestureDepth > 1) return { ...s, gestureDepth: s.gestureDepth - 1 };
    const changed = s.gestureBase !== null && s.doc !== null && s.gestureBase !== s.doc;
    const reset = { gestureDepth: 0, gestureBase: null, gestureLabel: '' };
    if (!changed) return { ...s, ...reset };
    return {
      ...s,
      ...reset,
      past: pushPast(s.past, { doc: s.gestureBase as StudioProject, label: s.gestureLabel }),
      future: [],
    };
  },
  selected: (s, ids) => {
    const next = s.doc ? pruneSelection(ids, s.doc) : [];
    return next.length === s.selection.length && next.every((id, i) => id === s.selection[i])
      ? s
      : { ...s, selection: next };
  },
  playheadSet: (s, t) => {
    const p = Math.max(0, Number.isFinite(t) ? t : 0);
    return p === s.playhead ? s : { ...s, playhead: p };
  },
  /**
   * A save landed (the web's `markSaved`): adopt the server's revision; clear `dirty` only when
   * nothing changed since the save started. The live tracks are kept (the user may have edited
   * mid-save); `updatedAt` is server metadata and is adopted without a history entry.
   */
  saved: (s, p) => ({
    ...s,
    doc: s.doc && p.updatedAt ? { ...s.doc, updatedAt: p.updatedAt } : s.doc,
    serverRevision: p.serverRevision ?? s.serverRevision,
    dirty: s.revision === p.atRevision ? false : s.dirty,
  }),
  /** Replace the doc without history ("Load theirs", a recovered draft). */
  replaced: (s, p) => {
    const doc = prepareProject(p.doc);
    return {
      ...s,
      doc,
      past: [],
      future: [],
      gestureDepth: 0,
      gestureBase: null,
      gestureLabel: '',
      selection: pruneSelection(s.selection, doc),
      revision: s.revision + 1,
      dirty: p.dirty ?? false,
      ...(p.serverRevision !== undefined ? { serverRevision: p.serverRevision } : {}),
    };
  },
  serverRevisionSet: (s, rev) => (s.serverRevision === rev ? s : { ...s, serverRevision: rev }),
  assetsSet: (s, list) => ({ ...s, assets: Object.fromEntries(list.map((a) => [a.id, a])) }),
  assetUpserted: (s, a) => ({ ...s, assets: { ...s.assets, [a.id]: a } }),
};

const make = <K extends keyof Payloads>(k: K) => createAction<Payloads[K]>(`studio/${k}`);
export const studioActions = {
  loaded: make('loaded'),
  closed: make('closed'),
  edited: make('edited'),
  undone: make('undone'),
  redone: make('redone'),
  gestureBegan: make('gestureBegan'),
  gestureEnded: make('gestureEnded'),
  selected: make('selected'),
  playheadSet: make('playheadSet'),
  saved: make('saved'),
  replaced: make('replaced'),
  serverRevisionSet: make('serverRevisionSet'),
  assetsSet: make('assetsSet'),
  assetUpserted: make('assetUpserted'),
};

const PREFIX = 'studio/';

export function studioReducer(state: StudioState | undefined, action: UnknownAction): StudioState {
  const s = state ?? initialStudioState();
  const key = action.type.startsWith(PREFIX)
    ? (action.type.slice(PREFIX.length) as keyof Payloads)
    : null;
  const h = key
    ? (handlers[key] as ((st: StudioState, p: unknown) => StudioState) | undefined)
    : undefined;
  return h ? h(s, (action as PayloadAction<unknown>).payload) : s;
}

export function makeStudioStore() {
  return configureStore({
    reducer: studioReducer,
    // EDLs are plain JSON; the checks would walk a large doc on every drag tick.
    middleware: (d) => d({ serializableCheck: false, immutableCheck: false }),
    devTools: false,
  });
}

export type StudioStore = ReturnType<typeof makeStudioStore>;

/**
 * `mutate(label, fn)`: the web store's capture point. `fn` gets the current doc and the store
 * state (for asset durations and the playhead) and returns the next doc, or the same reference
 * for a no-op (nothing is recorded).
 */
export function mutate(
  store: StudioStore,
  label: string,
  fn: (doc: StudioProject, state: StudioState) => StudioProject,
  selection?: string[],
) {
  const s = store.getState();
  if (!s.doc) return;
  store.dispatch(studioActions.edited({ next: fn(s.doc, s), label, selection }));
}

export const beginGesture = (store: StudioStore, label: string) =>
  store.dispatch(studioActions.gestureBegan(label));
export const endGesture = (store: StudioStore) => store.dispatch(studioActions.gestureEnded());
export const undo = (store: StudioStore) => store.dispatch(studioActions.undone());
export const redo = (store: StudioStore) => store.dispatch(studioActions.redone());

// Selectors (memoisation-free: each returns a stored reference).
export const selectDoc = (s: StudioState) => s.doc;
export const selectCanUndo = (s: StudioState) => s.past.length > 0 && s.gestureDepth === 0;
export const selectCanRedo = (s: StudioState) => s.future.length > 0 && s.gestureDepth === 0;
export const selectUndoLabel = (s: StudioState) => s.past[s.past.length - 1]?.label;
export const selectRedoLabel = (s: StudioState) => s.future[s.future.length - 1]?.label;
export function selectClip(s: StudioState, clipId: string) {
  if (!s.doc) return null;
  for (const track of s.doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}
