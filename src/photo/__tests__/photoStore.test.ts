import { newPhotoDoc, type PhotoDoc } from '../photoTypes';
import { upsertAdjustment } from '../layerOps';
import {
  makePhotoStore,
  mutate,
  photoActions,
  PHOTO_HISTORY_CAP,
  selectCanRedo,
  selectCanUndo,
} from '../photoStore';

const setEv = (ev: number) => (d: PhotoDoc) =>
  upsertAdjustment(d, 'exposure', (p) => ({ ...p, ev })).doc;

function loaded() {
  const store = makePhotoStore();
  store.dispatch(photoActions.loaded({ projectId: null, doc: newPhotoDoc(400, 300) }));
  return store;
}

describe('photo store', () => {
  it('a slider drag (gesture) lands as ONE undo entry, coalescing every tick', () => {
    const store = loaded();
    store.dispatch(photoActions.gestureBegan('exposure'));
    for (let i = 1; i <= 30; i += 1) mutate(store, 'exposure', setEv(i / 10));
    expect(selectCanUndo(store.getState())).toBe(false); // nothing to undo mid-drag
    store.dispatch(photoActions.gestureEnded());
    const s = store.getState();
    expect(s.past).toHaveLength(1);
    expect(s.past[0]!.label).toBe('exposure');
    expect(s.doc!.layers[0]!.params).toMatchObject({ ev: 3 });
    store.dispatch(photoActions.undone());
    expect(store.getState().doc!.layers).toHaveLength(0);
    expect(selectCanRedo(store.getState())).toBe(true);
    store.dispatch(photoActions.redone());
    expect(store.getState().doc!.layers[0]!.params).toMatchObject({ ev: 3 });
  });

  it('two separate gestures are two entries; a gesture with no change is none', () => {
    const store = loaded();
    for (const ev of [1, 2]) {
      store.dispatch(photoActions.gestureBegan('exposure'));
      mutate(store, 'exposure', setEv(ev));
      store.dispatch(photoActions.gestureEnded());
    }
    store.dispatch(photoActions.gestureBegan('exposure'));
    store.dispatch(photoActions.gestureEnded());
    expect(store.getState().past).toHaveLength(2);
  });

  it(`caps the undo history at ${PHOTO_HISTORY_CAP}, dropping the oldest`, () => {
    const store = loaded();
    for (let i = 1; i <= PHOTO_HISTORY_CAP + 25; i += 1) mutate(store, `step ${i}`, setEv(i / 100));
    const s = store.getState();
    expect(s.past).toHaveLength(PHOTO_HISTORY_CAP);
    expect(s.past[0]!.label).toBe('step 26');
  });

  it('an edit after undo clears redo; structural sharing keeps snapshots as pointers', () => {
    const store = loaded();
    mutate(store, 'a', setEv(1));
    const afterA = store.getState().doc;
    mutate(store, 'b', setEv(2));
    expect(store.getState().past[1]!.doc).toBe(afterA);
    store.dispatch(photoActions.undone());
    mutate(store, 'c', setEv(3));
    expect(store.getState().future).toHaveLength(0);
  });

  it('tracks dirty and revision; a save clears dirty only if nothing changed meanwhile', () => {
    const store = loaded();
    expect(store.getState().dirty).toBe(false);
    mutate(store, 'a', setEv(1));
    const at = store.getState().revision;
    expect(store.getState().dirty).toBe(true);
    store.dispatch(photoActions.saved({ serverRevision: 2, atRevision: at }));
    expect(store.getState()).toMatchObject({ dirty: false, serverRevision: 2 });
    mutate(store, 'b', setEv(2));
    const stale = store.getState().revision - 1;
    store.dispatch(photoActions.saved({ serverRevision: 3, atRevision: stale }));
    expect(store.getState().dirty).toBe(true);
  });

  it('a no-op mutate changes nothing', () => {
    const store = loaded();
    const before = store.getState();
    mutate(store, 'noop', (d) => d);
    expect(store.getState()).toBe(before);
  });

  it('replaced (load theirs / draft) resets history', () => {
    const store = loaded();
    mutate(store, 'a', setEv(1));
    store.dispatch(photoActions.replaced({ doc: newPhotoDoc(400, 300), serverRevision: 7 }));
    expect(store.getState()).toMatchObject({
      past: [],
      future: [],
      dirty: false,
      serverRevision: 7,
    });
  });
});
