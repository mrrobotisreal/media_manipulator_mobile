/**
 * Native bindings for the Darkroom session (MMKV drafts, the document-directory draft files). Kept
 * apart from the pure modules so their jest suites never load native code; the editor screen
 * (MA63) builds its session from these.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { mmkvStorage } from '@/state/persist';
import type { DraftFiles, DraftStorage } from './drafts';

/** `Paths.document/studio-drafts/`: large (> 2 MB) drafts; documents survive cache clears. */
export const STUDIO_DRAFTS_DIR = 'studio-drafts';

const draftFiles: DraftFiles = {
  async write(name, text) {
    const dir = new Directory(Paths.document, STUDIO_DRAFTS_DIR);
    dir.create({ intermediates: true, idempotent: true });
    const f = new File(dir, name);
    f.create({ intermediates: true, overwrite: true });
    f.write(text);
  },
  async read(name) {
    try {
      const f = new File(new Directory(Paths.document, STUDIO_DRAFTS_DIR), name);
      return f.exists ? await f.text() : null;
    } catch {
      return null;
    }
  },
  async remove(name) {
    try {
      const f = new File(new Directory(Paths.document, STUDIO_DRAFTS_DIR), name);
      if (f.exists) f.delete();
    } catch {
      // best effort
    }
  },
};

export const appStudioDraftStorage: DraftStorage = { kv: mmkvStorage, files: draftFiles };
