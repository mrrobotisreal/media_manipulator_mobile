import { upsertAdjustment } from '../layerOps';
import { newPhotoDoc } from '../photoTypes';
import {
  clearDraft,
  createDraftWriter,
  draftKey,
  DRAFT_DEBOUNCE_MS,
  readDraft,
  shouldOfferRecovery,
  writeDraft,
  type DraftStorage,
} from '../drafts';

function memory(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    setItem: async (k, v) => void map.set(k, v),
    getItem: async (k) => map.get(k),
    removeItem: async (k) => void map.delete(k),
  };
}

const edited = () =>
  upsertAdjustment(newPhotoDoc(400, 300), 'exposure', (p) => ({ ...p, ev: 1 })).doc;

describe('photo drafts', () => {
  it('writes and recovers a draft under photoDraft:<projectId>', async () => {
    const s = memory();
    await writeDraft(s, draftKey('p1'), { doc: edited(), baseRevision: 3, savedAt: 42 });
    expect([...s.map.keys()]).toEqual(['photoDraft:p1']);
    const d = await readDraft(s, draftKey('p1'));
    expect(d).toMatchObject({ baseRevision: 3, savedAt: 42 });
    expect(d!.doc.layers[0]!.params).toMatchObject({ ev: 1 });
    await clearDraft(s, draftKey('p1'));
    expect(await readDraft(s, draftKey('p1'))).toBeNull();
  });

  it('offers recovery only when the draft differs from the server doc', async () => {
    const s = memory();
    await writeDraft(s, 'k', { doc: edited(), baseRevision: 1, savedAt: 1 });
    const d = await readDraft(s, 'k');
    expect(shouldOfferRecovery(d, newPhotoDoc(400, 300))).toBe(true);
    expect(shouldOfferRecovery(d, edited())).toBe(false);
    expect(shouldOfferRecovery(null, edited())).toBe(false);
  });

  it('ignores a corrupt or unreadable draft', async () => {
    const s = memory();
    s.map.set('a', 'not json');
    s.map.set('b', JSON.stringify({ v: 1, doc: '{"version":2}' }));
    expect(await readDraft(s, 'a')).toBeNull();
    expect(await readDraft(s, 'b')).toBeNull();
  });

  it('debounces writes to one per 2 s and flushes on demand', async () => {
    jest.useFakeTimers();
    const s = memory();
    let doc = newPhotoDoc(400, 300);
    const w = createDraftWriter(s, () => ({
      key: 'k',
      draft: { doc, baseRevision: null, savedAt: Date.now() },
    }));
    w.schedule();
    doc = edited();
    w.schedule();
    expect(s.map.size).toBe(0);
    jest.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect((await readDraft(s, 'k'))!.doc.layers).toHaveLength(1); // the last value won
    s.map.clear();
    w.schedule();
    await w.flush();
    expect(s.map.size).toBe(1);
    jest.useRealTimers();
  });
});
