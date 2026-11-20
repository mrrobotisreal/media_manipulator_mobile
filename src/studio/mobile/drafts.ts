/**
 * Crash-recovery drafts for Darkroom (ticket MA61 decision 5; ADR ws/0001 item 2), the MMKV
 * rewrite of the web's IndexedDB `draftStore.ts`:
 *
 * - the editor's EDL is written under `studioDraft:<projectId>` at most every 3 s while it is dirty
 *   (the web's `DRAFT_WRITE_THROTTLE_MS`), and at once on `flush()` (app background, screen blur);
 * - a serialized EDL above 2 MB goes to a file in the document directory
 *   (`studio-drafts/<projectId>.json`) and MMKV keeps only a pointer, so a 1,000-clip project never
 *   bloats the MMKV instance that every launch maps into memory;
 * - on reopen the copied web `draftRecovery.evaluateDraft` decides: discard / recover / conflict.
 *
 * Storage is injected (MMKV + expo-file-system in the app, Maps in tests). Drafts are best effort:
 * every failure degrades to "no draft", never to a crash.
 */
import { studioProjectSchema, type StudioProject } from '../studioTypes';

/** The web's `StudioDraft` shape (the copied `draftRecovery.ts` type-imports it from here). */
export interface StudioDraft {
  projectId: string;
  /** Server revision the drafted document was loaded / last saved at; null in legacy mode. */
  baseRevision: number | null;
  /** Client clock at write time, epoch ms. */
  savedAt: number;
  /** The full EDL document as it stood at write time. */
  document: StudioProject;
  appVersion?: string;
}

export const DRAFT_WRITE_THROTTLE_MS = 3000;
/** Above this many UTF-16 code units (≈ bytes for JSON) the draft goes to a file. */
export const DRAFT_MMKV_MAX_CHARS = 2 * 1024 * 1024;
export const studioDraftKey = (projectId: string) => `studioDraft:${projectId}`;
export const studioDraftFileName = (projectId: string) =>
  `${projectId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;

export interface DraftKv {
  setItem(key: string, value: string): Promise<unknown>;
  getItem(key: string): Promise<string | null | undefined>;
  removeItem(key: string): Promise<unknown>;
}

/** The document-directory side (`studio-drafts/<name>`). */
export interface DraftFiles {
  write(name: string, text: string): Promise<void>;
  read(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
}

export interface DraftStorage {
  kv: DraftKv;
  files: DraftFiles;
}

interface Envelope {
  v: 1;
  projectId: string;
  baseRevision: number | null;
  savedAt: number;
  appVersion?: string;
  /** Inline document JSON, or absent when it lives in `file`. */
  doc?: string;
  file?: string;
}

export async function writeStudioDraft(storage: DraftStorage, d: StudioDraft): Promise<void> {
  const doc = JSON.stringify(d.document);
  const base = {
    v: 1 as const,
    projectId: d.projectId,
    baseRevision: d.baseRevision,
    savedAt: d.savedAt,
    appVersion: d.appVersion,
  };
  const name = studioDraftFileName(d.projectId);
  if (doc.length > DRAFT_MMKV_MAX_CHARS) {
    await storage.files.write(name, doc);
    await storage.kv.setItem(studioDraftKey(d.projectId), JSON.stringify({ ...base, file: name }));
    return;
  }
  await storage.kv.setItem(studioDraftKey(d.projectId), JSON.stringify({ ...base, doc }));
  // A previous large draft of this project would otherwise linger on disk.
  await storage.files.remove(name).catch(() => undefined);
}

export async function readStudioDraft(
  storage: DraftStorage,
  projectId: string,
): Promise<StudioDraft | null> {
  try {
    const raw = await storage.kv.getItem(studioDraftKey(projectId));
    if (!raw) return null;
    const env = JSON.parse(raw) as Partial<Envelope>;
    if (env.v !== 1 || env.projectId !== projectId) return null;
    const text =
      typeof env.doc === 'string' ? env.doc : env.file ? await storage.files.read(env.file) : null;
    if (!text) return null;
    const parsed = studioProjectSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return {
      projectId,
      baseRevision: typeof env.baseRevision === 'number' ? env.baseRevision : null,
      savedAt: typeof env.savedAt === 'number' ? env.savedAt : 0,
      document: parsed.data,
      appVersion: typeof env.appVersion === 'string' ? env.appVersion : undefined,
    };
  } catch {
    return null;
  }
}

export async function deleteStudioDraft(storage: DraftStorage, projectId: string): Promise<void> {
  await storage.kv.removeItem(studioDraftKey(projectId)).catch(() => undefined);
  await storage.files.remove(studioDraftFileName(projectId)).catch(() => undefined);
}

/**
 * Trailing-throttle writer: `schedule()` after every change writes once per 3 s window (the last
 * value wins); `flush()` writes now. `read()` returns null when there is nothing to draft (clean).
 */
export function createStudioDraftWriter(
  storage: DraftStorage,
  read: () => StudioDraft | null,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = {
    set: setTimeout,
    clear: clearTimeout,
  },
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWritten: StudioProject | null = null;
  const write = async () => {
    timer = null;
    const cur = read();
    if (!cur) return;
    try {
      await writeStudioDraft(storage, cur);
      lastWritten = cur.document;
    } catch {
      // best effort: a full disk must never break editing
    }
  };
  return {
    schedule() {
      if (timer) return;
      timer = timers.set(() => void write(), DRAFT_WRITE_THROTTLE_MS);
    },
    async flush() {
      if (timer) timers.clear(timer);
      await write();
    },
    cancel() {
      if (timer) timers.clear(timer);
      timer = null;
    },
    /** The document reference of the last draft that reached storage (locally safe work). */
    lastWritten: () => lastWritten,
  };
}
