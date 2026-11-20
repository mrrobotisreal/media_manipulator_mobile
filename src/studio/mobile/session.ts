/**
 * One Darkroom editor session (ticket MA61 decision 4; ADR ws/0001), as plain TypeScript over
 * injected calls so the flows are tested without React or the network:
 *
 * - **open**: `GET /studio/projects/:id` -> the copied `normalizeProject` (in the store's `loaded`)
 *   -> the local draft, judged by the copied web `evaluateDraft` (discard / recover / conflict).
 * - **autosave**: 1.2 s after the last edit (the web's debounce), a `PUT` of the web's save body
 *   with `expectedRevision`. The copied `saveState` machine drives retries: network / 5xx back off
 *   (1.2 s, 2.4 s … 30 s), other 4xx park in `failed`, offline waits for `setOnline(true)`.
 * - **conflict**: 409 `revision_conflict {currentRevision, updatedAt}` parks the machine in
 *   `conflict` (autosave blocked) and `conflict()` returns the body for the shared `ConflictSheet`.
 *   "Keep mine" re-sends with `expectedRevision = currentRevision` (the web's "take over"); "Load
 *   theirs" reloads the server copy, without history.
 * - **drafts**: every dirty change schedules the 3 s draft writer (`drafts.ts`); a landed save
 *   deletes the draft once nothing is left unsaved.
 *
 * Version history is read-only and not wired here in phase 1 (DARKROOM_MOBILE.md §7).
 */
import type { MmError } from '@/api/errors';
import { evaluateDraft, type DraftDecision } from '../draftRecovery';
import { createSaveStateMachine, type SaveStateSnapshot } from '../saveState';
import type { StudioProject, StudioSaveProjectRequest } from '../studioTypes';
import {
  createStudioDraftWriter,
  deleteStudioDraft,
  readStudioDraft,
  type DraftStorage,
  type StudioDraft,
} from './drafts';
import { isRetryableSaveError, studioConflictOf, toSaveRequest } from './sessionApi';
import { studioActions, type StudioStore } from './studioStore';

export const AUTOSAVE_DEBOUNCE_MS = 1200;

type Result<T> = { ok: true; value: T } | { ok: false; error: MmError };

export interface StudioSessionApi {
  getProject(id: string): Promise<Result<StudioProject>>;
  saveProject(input: {
    id: string;
    body: StudioSaveProjectRequest;
  }): Promise<Result<StudioProject>>;
}

export interface StudioSessionDeps {
  api: StudioSessionApi;
  store: StudioStore;
  drafts: DraftStorage;
  now(): number;
  /** Connectivity at the moment (expo-network in the app); default online. */
  isOnline?: () => boolean;
  appVersion?: string;
}

export type OpenResult =
  | { ok: true; draft: StudioDraft | null; decision: DraftDecision | null }
  | { ok: false; error: MmError };

export interface StudioConflict {
  currentRevision: number | null;
  updatedAt: string | null;
}

export function createStudioSession(deps: StudioSessionDeps) {
  const { api, store } = deps;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  let conflict: StudioConflict | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> | null = null;
  let disposed = false;
  let seenRevision = store.getState().revision;

  const machine = createSaveStateMachine({
    onRetry: () => void runSave(),
    isOnline: deps.isOnline,
  });
  machine.subscribe(emit);

  const drafts = createStudioDraftWriter(deps.drafts, () => {
    const s = store.getState();
    if (!s.dirty || !s.doc || !s.projectId) return null;
    return {
      projectId: s.projectId,
      baseRevision: s.serverRevision,
      savedAt: deps.now(),
      document: s.doc,
      appVersion: deps.appVersion,
    };
  });

  const cancelDebounce = () => {
    if (debounce) clearTimeout(debounce);
    debounce = null;
  };
  const scheduleSave = () => {
    cancelDebounce();
    debounce = setTimeout(() => {
      debounce = null;
      // A drag still in progress: wait for it to end (its last tick reschedules).
      if (store.getState().gestureDepth > 0) return scheduleSave();
      void runSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  // Every document change while dirty is an edit: the machine leaves `saved`, the debounce and the
  // draft writer start. Loads and "Load theirs" are not dirty and schedule nothing.
  const unsubscribe = store.subscribe(() => {
    const s = store.getState();
    if (s.revision === seenRevision) return;
    seenRevision = s.revision;
    if (!s.dirty || !s.doc) return;
    machine.dispatch({ type: 'edit' });
    drafts.schedule();
    if (machine.getSnapshot().state === 'conflict') return; // the sheet is open: no autosave
    scheduleSave();
  });

  /**
   * The one save path (debounce, machine retries, keep mine). `override`: undefined = the store's
   * revision (normal compare-and-set); a number = take over at that revision; null = legacy
   * last-write-wins (a 409 body without a revision). Resolves true when the save landed.
   */
  async function runSave(override?: number | null): Promise<boolean> {
    if (disposed) return false;
    if (inFlight) {
      // One PUT at a time; the next one starts from the state after it.
      await inFlight;
      if (!store.getState().dirty) return true;
    }
    const s = store.getState();
    if (!s.doc || !s.projectId) return false;
    if (override === undefined && machine.getSnapshot().state === 'conflict') return false;
    const body = toSaveRequest(s.doc, override === undefined ? s.serverRevision : override);
    const atRevision = s.revision;
    const projectId = s.projectId;
    machine.dispatch({ type: 'saveStart' });
    const attempt = (async () => {
      const res = await api.saveProject({ id: projectId, body });
      if (disposed || store.getState().projectId !== projectId) return false;
      if (res.ok) {
        store.dispatch(
          studioActions.saved({
            serverRevision: res.value.revision ?? null,
            atRevision,
            updatedAt: res.value.updatedAt,
          }),
        );
        machine.dispatch({ type: 'saveOk' });
        if (!store.getState().dirty) await deleteStudioDraft(deps.drafts, projectId);
        return true;
      }
      const c = studioConflictOf(res.error);
      if (c) {
        conflict = c;
        cancelDebounce();
        machine.dispatch({ type: 'save409' });
        // Keep the work locally safe while the sheet is open.
        await drafts.flush();
        emit();
        return false;
      }
      machine.dispatch({
        type: isRetryableSaveError(res.error) ? 'saveNetworkError' : 'saveHardError',
      });
      return false;
    })();
    inFlight = attempt;
    try {
      return await attempt;
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  }

  async function open(id: string): Promise<OpenResult> {
    const res = await api.getProject(id);
    if (!res.ok) return { ok: false, error: res.error };
    store.dispatch(
      studioActions.loaded({
        projectId: id,
        doc: res.value,
        serverRevision: res.value.revision ?? null,
      }),
    );
    seenRevision = store.getState().revision;
    conflict = null;
    const draft = await readStudioDraft(deps.drafts, id);
    if (!draft) return { ok: true, draft: null, decision: null };
    const decision = evaluateDraft(draft, res.value);
    if (decision === 'discard') {
      await deleteStudioDraft(deps.drafts, id);
      return { ok: true, draft: null, decision };
    }
    return { ok: true, draft, decision };
  }

  /**
   * Restores a recovered draft (dirty, so autosave saves it). After a `conflict` decision the
   * store holds the server's fresh revision, so the save that follows takes over on top of it,
   * the web's "recover and take over".
   */
  function recover(draft: StudioDraft) {
    store.dispatch(studioActions.replaced({ doc: draft.document, dirty: true }));
  }

  async function discardDraft() {
    const id = store.getState().projectId;
    if (id) await deleteStudioDraft(deps.drafts, id);
  }

  /** Conflict sheet, "Keep mine": overwrite on top of the server's revision. */
  async function keepMine(): Promise<boolean> {
    const c = conflict;
    if (!c) return false;
    conflict = null;
    machine.dispatch({ type: 'conflictResolved' });
    emit();
    return runSave(c.currentRevision);
  }

  /** Conflict sheet, "Load theirs": the server's project replaces the local one (no history). */
  async function loadTheirs(): Promise<boolean> {
    const id = store.getState().projectId;
    if (!id) return false;
    const res = await api.getProject(id);
    if (!res.ok) return false;
    cancelDebounce();
    drafts.cancel();
    store.dispatch(
      studioActions.replaced({
        doc: res.value,
        serverRevision: res.value.revision ?? null,
        dirty: false,
      }),
    );
    seenRevision = store.getState().revision;
    await deleteStudioDraft(deps.drafts, id);
    conflict = null;
    machine.dispatch({ type: 'conflictResolved' });
    emit();
    return true;
  }

  /** App background / screen blur: write the draft now and save pending work at once. */
  async function flush(): Promise<void> {
    await drafts.flush();
    if (debounce && store.getState().dirty) {
      cancelDebounce();
      await runSave();
    }
  }

  return {
    open,
    recover,
    discardDraft,
    save: () => runSave(),
    keepMine,
    loadTheirs,
    flush,
    /** expo-network connectivity changes. */
    setOnline(online: boolean) {
      machine.dispatch({ type: online ? 'online' : 'offline' });
    },
    conflict: (): StudioConflict | null => conflict,
    saveState: (): SaveStateSnapshot => machine.getSnapshot(),
    /** Work that reached neither the server nor a draft (the "leave anyway?" guard). */
    hasUnsafeWork(): boolean {
      const s = store.getState();
      return s.dirty && s.doc !== drafts.lastWritten();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose() {
      disposed = true;
      cancelDebounce();
      drafts.cancel();
      unsubscribe();
      machine.dispose();
      listeners.clear();
    },
  };
}

export type StudioSession = ReturnType<typeof createStudioSession>;
