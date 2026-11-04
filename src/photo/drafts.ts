/**
 * Crash-recovery drafts (ticket MA50 decision 5): the editor's doc is written to MMKV under
 * `photoDraft:<projectId>` at most every 2 s while it is dirty; reopening a project with a draft
 * newer than the server's offers "Recovered unsaved changes". A local, not-yet-uploaded session is
 * keyed `photoDraft:local:<intakeId>` until the project id arrives, then moved.
 *
 * The storage is injected (`mmkvStorage` in the app, a Map in tests).
 */
import { canonicalPhotoDoc, parsePhotoDoc, type PhotoDoc } from './photoTypes';

export const DRAFT_DEBOUNCE_MS = 2000;
export const draftKey = (projectId: string) => `photoDraft:${projectId}`;
export const localDraftKey = (intakeId: string) => `photoDraft:local:${intakeId}`;

export interface DraftStorage {
  setItem(key: string, value: string): Promise<unknown>;
  getItem(key: string): Promise<string | null | undefined>;
  removeItem(key: string): Promise<unknown>;
}

export interface Draft {
  doc: PhotoDoc;
  /** The server revision the draft was based on (null before the project existed). */
  baseRevision: number | null;
  savedAt: number;
  name?: string;
}

export async function writeDraft(storage: DraftStorage, key: string, d: Draft): Promise<void> {
  const payload = JSON.stringify({
    v: 1,
    doc: canonicalPhotoDoc(d.doc),
    baseRevision: d.baseRevision,
    savedAt: d.savedAt,
    name: d.name,
  });
  await storage.setItem(key, payload);
}

export async function readDraft(storage: DraftStorage, key: string): Promise<Draft | null> {
  let raw: string | null | undefined;
  try {
    raw = await storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as {
      v?: number;
      doc?: string;
      baseRevision?: number | null;
      savedAt?: number;
      name?: string;
    };
    if (o.v !== 1 || typeof o.doc !== 'string') return null;
    const parsed = parsePhotoDoc(o.doc);
    if (!parsed.ok) return null;
    return {
      doc: parsed.doc,
      baseRevision: typeof o.baseRevision === 'number' ? o.baseRevision : null,
      savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
      name: typeof o.name === 'string' ? o.name : undefined,
    };
  } catch {
    return null;
  }
}

export const clearDraft = (storage: DraftStorage, key: string) =>
  storage.removeItem(key).then(() => undefined);

/** Recovery is offered when the draft differs from what the server holds. */
export function shouldOfferRecovery(draft: Draft | null, serverDoc: PhotoDoc): boolean {
  if (!draft) return false;
  return canonicalPhotoDoc(draft.doc) !== canonicalPhotoDoc(serverDoc);
}

/**
 * Debounced writer: `schedule()` after every change; the doc is written once per 2 s window (the
 * last value wins) and immediately on `flush()` (app background, screen blur).
 */
export function createDraftWriter(
  storage: DraftStorage,
  read: () => { key: string; draft: Draft } | null,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = {
    set: setTimeout,
    clear: clearTimeout,
  },
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = async () => {
    timer = null;
    const cur = read();
    if (cur) await writeDraft(storage, cur.key, cur.draft).catch(() => undefined);
  };
  return {
    schedule() {
      if (timer) return;
      timer = timers.set(() => void write(), DRAFT_DEBOUNCE_MS);
    },
    async flush() {
      if (timer) timers.clear(timer);
      await write();
    },
    cancel() {
      if (timer) timers.clear(timer);
      timer = null;
    },
  };
}
