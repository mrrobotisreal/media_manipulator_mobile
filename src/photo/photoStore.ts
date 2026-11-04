/**
 * The Aperture editor state (ticket MA50 decision 6): a Redux slice in its own store, never in
 * component state. Ported from the web's `lib/photo/photoStore.ts` (zustand) with the same
 * semantics: every edit is `mutate(label, fn)`; documents are immutable and structurally shared,
 * so an undo snapshot is one pointer; a slider drag runs inside `beginGesture` / `endGesture` and
 * lands as ONE undo entry. The undo cap is 100 (the web's 200, halved for phone memory; proposed).
 *
 * Why a separate store: the app store is persisted by redux-persist (MMKV) and mirrored to dev
 * tools; a 64-layer doc with a .cube LUT at every slider tick does not belong there. Drafts are
 * written by `drafts.ts` instead.
 */
import {
  configureStore,
  createAction,
  type PayloadAction,
  type UnknownAction,
} from '@reduxjs/toolkit';
import type { PhotoDoc } from './photoTypes';

export const PHOTO_HISTORY_CAP = 100;

export interface PhotoHistoryEntry {
  doc: PhotoDoc;
  label: string;
}

export interface PhotoState {
  projectId: string | null;
  doc: PhotoDoc | null;
  name: string;
  selection: string | null;
  past: PhotoHistoryEntry[];
  future: PhotoHistoryEntry[];
  gestureDepth: number;
  gestureBase: PhotoDoc | null;
  gestureLabel: string;
  /** Bumped on every document change (drafts debounce on it). */
  revision: number;
  /** The doc differs from the last saved/loaded one. */
  dirty: boolean;
  /** The server revision the doc is based on (If-Match); null until the project exists. */
  serverRevision: number | null;
}

export const initialPhotoState = (): PhotoState => ({
  projectId: null,
  doc: null,
  name: '',
  selection: null,
  past: [],
  future: [],
  gestureDepth: 0,
  gestureBase: null,
  gestureLabel: '',
  revision: 0,
  dirty: false,
  serverRevision: null,
});

function pushPast(past: PhotoHistoryEntry[], entry: PhotoHistoryEntry): PhotoHistoryEntry[] {
  const next = [...past, entry];
  return next.length > PHOTO_HISTORY_CAP ? next.slice(next.length - PHOTO_HISTORY_CAP) : next;
}

const pruneSelection = (sel: string | null, doc: PhotoDoc) =>
  sel && doc.layers.some((l) => l.id === sel) ? sel : null;

// A plain reducer, deliberately not `createSlice`: Immer would wrap every stored doc in a draft and
// freeze copies, so `next === s.doc` (no-op edits) and one-pointer snapshots would stop holding.
// Each case returns the same object when nothing changes.
type Handlers = { [K in keyof Payloads]: (s: PhotoState, payload: Payloads[K]) => PhotoState };
interface Payloads {
  loaded: {
    projectId: string | null;
    doc: PhotoDoc;
    name?: string;
    serverRevision?: number | null;
  };
  closed: void;
  projectIdSet: { projectId: string; serverRevision: number };
  renamed: string;
  edited: { next: PhotoDoc; label: string; selection?: string | null };
  undone: void;
  redone: void;
  gestureBegan: string;
  gestureEnded: void;
  selected: string | null;
  saved: { serverRevision: number; atRevision: number };
  replaced: { doc: PhotoDoc; serverRevision?: number | null; dirty?: boolean };
  /** History sheet: move along the timeline by `steps` (negative = undo). */
  jumped: number;
  /** History sheet: forget the undo/redo stacks (the doc stays). */
  historyCleared: void;
}

const handlers: Handlers = {
  loaded: (s, p) => ({
    ...initialPhotoState(),
    projectId: p.projectId,
    doc: p.doc,
    name: p.name ?? '',
    serverRevision: p.serverRevision ?? null,
    revision: s.revision + 1,
  }),
  closed: () => initialPhotoState(),
  projectIdSet: (s, p) => ({ ...s, projectId: p.projectId, serverRevision: p.serverRevision }),
  renamed: (s, name) =>
    s.name === name ? s : { ...s, name, revision: s.revision + 1, dirty: true },
  edited: (s, { next, label, selection }) => {
    if (!s.doc) return s;
    if (next === s.doc)
      return selection !== undefined && selection !== s.selection ? { ...s, selection } : s;
    const view = {
      doc: next,
      selection: pruneSelection(selection === undefined ? s.selection : selection, next),
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
    if (s.gestureDepth === 0) return s;
    if (s.gestureDepth > 1) return { ...s, gestureDepth: s.gestureDepth - 1 };
    const changed = s.gestureBase !== null && s.doc !== null && s.gestureBase !== s.doc;
    const reset = { gestureDepth: 0, gestureBase: null, gestureLabel: '' };
    if (!changed) return { ...s, ...reset };
    return {
      ...s,
      ...reset,
      past: pushPast(s.past, { doc: s.gestureBase as PhotoDoc, label: s.gestureLabel }),
      future: [],
    };
  },
  selected: (s, id) => (s.selection === id ? s : { ...s, selection: id }),
  /** A save landed: clears `dirty` only when nothing changed since the save started. */
  saved: (s, p) => ({
    ...s,
    serverRevision: p.serverRevision,
    dirty: s.revision === p.atRevision ? false : s.dirty,
  }),
  jumped: (s, steps) => {
    let cur = s;
    const n = Math.abs(Math.trunc(steps));
    for (let i = 0; i < n; i += 1) {
      const next = steps < 0 ? handlers.undone(cur) : handlers.redone(cur);
      if (next === cur) break;
      cur = next;
    }
    return cur;
  },
  historyCleared: (s) =>
    s.past.length === 0 && s.future.length === 0 ? s : { ...s, past: [], future: [] },
  /** Replace the doc without history ("Load theirs", a recovered draft). */
  replaced: (s, p) => ({
    ...s,
    doc: p.doc,
    past: [],
    future: [],
    gestureDepth: 0,
    gestureBase: null,
    gestureLabel: '',
    selection: pruneSelection(s.selection, p.doc),
    revision: s.revision + 1,
    dirty: p.dirty ?? false,
    ...(p.serverRevision !== undefined ? { serverRevision: p.serverRevision } : {}),
  }),
};

const make = <K extends keyof Payloads>(k: K) => createAction<Payloads[K]>(`photo/${k}`);
export const photoActions = {
  loaded: make('loaded'),
  closed: make('closed'),
  projectIdSet: make('projectIdSet'),
  renamed: make('renamed'),
  edited: make('edited'),
  undone: make('undone'),
  redone: make('redone'),
  gestureBegan: make('gestureBegan'),
  gestureEnded: make('gestureEnded'),
  selected: make('selected'),
  saved: make('saved'),
  replaced: make('replaced'),
  jumped: make('jumped'),
  historyCleared: make('historyCleared'),
};

export function photoReducer(state: PhotoState | undefined, action: UnknownAction): PhotoState {
  const s = state ?? initialPhotoState();
  const key = action.type.startsWith('photo/') ? (action.type.slice(6) as keyof Payloads) : null;
  const h = key
    ? (handlers[key] as ((st: PhotoState, p: unknown) => PhotoState) | undefined)
    : undefined;
  return h ? h(s, (action as PayloadAction<unknown>).payload) : s;
}

export function makePhotoStore() {
  return configureStore({
    reducer: photoReducer,
    // Docs are plain JSON; the checks would walk a large doc on every slider tick.
    middleware: (d) => d({ serializableCheck: false, immutableCheck: false }),
    devTools: false,
  });
}

export type PhotoStore = ReturnType<typeof makePhotoStore>;

/** `mutate(label, fn)`: the web's store API, over the slice. */
export function mutate(
  store: PhotoStore,
  label: string,
  fn: (doc: PhotoDoc) => PhotoDoc,
  selection?: string | null,
) {
  const doc = store.getState().doc;
  if (!doc) return;
  store.dispatch(photoActions.edited({ next: fn(doc), label, selection }));
}

// Selectors (memoisation-free: each returns a stored reference).
export const selectDoc = (s: PhotoState) => s.doc;
export const selectCanUndo = (s: PhotoState) => s.past.length > 0 && s.gestureDepth === 0;
export const selectCanRedo = (s: PhotoState) => s.future.length > 0 && s.gestureDepth === 0;
export const selectLayer = (id: string | null) => (s: PhotoState) =>
  id ? (s.doc?.layers.find((l) => l.id === id) ?? null) : null;
