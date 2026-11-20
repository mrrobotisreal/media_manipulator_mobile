import { studioFixture } from '../../fixtures/studioFixture';
import type { StudioProject } from '../../studioTypes';
import { createAppStudioBackend, getActiveStudioBackend } from '../backend';
import { moveClip, setClipVolume, splitAt } from '../edits';
import {
  STUDIO_HISTORY_CAP,
  beginGesture,
  endGesture,
  makeStudioStore,
  mutate,
  redo,
  selectCanRedo,
  selectCanUndo,
  selectUndoLabel,
  studioActions,
  undo,
} from '../studioStore';
import { studioProxyUrl, studioSpriteUrl, studioPeaksUrl } from '../../previewEngine';

const open = (doc: StudioProject = studioFixture()) => {
  const store = makeStudioStore();
  store.dispatch(studioActions.loaded({ projectId: doc.id, doc, serverRevision: 7 }));
  return store;
};
const clipOf = (doc: StudioProject | null, id: string) =>
  doc!.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;

describe('studio store', () => {
  it('loads a project normalized to v3, clean, with the server revision', () => {
    const s = open().getState();
    expect(s.doc?.schemaVersion).toBe(3);
    expect(s.dirty).toBe(false);
    expect(s.serverRevision).toBe(7);
    expect(selectCanUndo(s)).toBe(false);
  });

  it('mutate records one undo step; undo/redo restore the exact snapshot', () => {
    const store = open();
    const before = store.getState().doc;
    mutate(store, 'Volume', (d) => setClipVolume(d, 'clipA', 0.5));
    const after = store.getState().doc;
    expect(clipOf(after, 'clipA').volume).toBe(0.5);
    expect(store.getState().dirty).toBe(true);
    expect(selectUndoLabel(store.getState())).toBe('Volume');
    undo(store);
    expect(store.getState().doc).toBe(before);
    redo(store);
    expect(store.getState().doc).toBe(after);
    expect(selectCanRedo(store.getState())).toBe(false);
  });

  it('a no-op edit records nothing', () => {
    const store = open();
    const rev = store.getState().revision;
    mutate(store, 'Nothing', (d) => d);
    mutate(store, 'Move in place', (d) => moveClip(d, 'clipB', clipOf(d, 'clipB').timelineStart));
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().revision).toBe(rev);
    expect(store.getState().dirty).toBe(false);
  });

  it('a drag (gesture) of many ticks is ONE undo step back to the pre-drag doc', () => {
    const store = open();
    const before = store.getState().doc;
    beginGesture(store, 'Move');
    for (let x = 1; x <= 20; x += 1) mutate(store, 'Move', (d) => moveClip(d, 'clipB', 12 + x));
    // Nested begin/end (e.g. a sheet inside the drag) does not split the step.
    beginGesture(store, 'inner');
    mutate(store, 'Move', (d) => moveClip(d, 'clipB', 40));
    endGesture(store);
    expect(selectCanUndo(store.getState())).toBe(false); // nothing committed mid-gesture
    endGesture(store);
    expect(store.getState().past).toHaveLength(1);
    expect(selectUndoLabel(store.getState())).toBe('Move');
    undo(store);
    expect(store.getState().doc).toBe(before);
  });

  it('a gesture that changed nothing records nothing; an unbalanced end is tolerated', () => {
    const store = open();
    beginGesture(store, 'Move');
    endGesture(store);
    endGesture(store);
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('undo is ignored while a gesture is open', () => {
    const store = open();
    mutate(store, 'Volume', (d) => setClipVolume(d, 'clipA', 0.5));
    beginGesture(store, 'Move');
    mutate(store, 'Move', (d) => moveClip(d, 'clipB', 30));
    const mid = store.getState().doc;
    undo(store);
    expect(store.getState().doc).toBe(mid);
    endGesture(store);
  });

  it(`caps history at ${STUDIO_HISTORY_CAP}, dropping the oldest`, () => {
    const store = open();
    const docs: (StudioProject | null)[] = [store.getState().doc];
    for (let i = 1; i <= STUDIO_HISTORY_CAP + 10; i += 1) {
      mutate(store, `v${i}`, (d) => setClipVolume(d, 'clipA', (i % 200) / 100));
      docs.push(store.getState().doc);
    }
    const s = store.getState();
    expect(s.past).toHaveLength(STUDIO_HISTORY_CAP);
    expect(s.past[0]!.doc).toBe(docs[10]);
    for (let i = 0; i < STUDIO_HISTORY_CAP + 5; i += 1) undo(store);
    expect(store.getState().doc).toBe(docs[10]);
  });

  it('a new edit after undo clears redo', () => {
    const store = open();
    mutate(store, 'a', (d) => setClipVolume(d, 'clipA', 0.5));
    undo(store);
    mutate(store, 'b', (d) => setClipVolume(d, 'clipA', 0.7));
    expect(selectCanRedo(store.getState())).toBe(false);
  });

  it('selection and playhead never enter history; undo prunes dead selection only', () => {
    const store = open();
    store.dispatch(studioActions.playheadSet(5));
    mutate(store, 'Split', (d, s) => splitAt(d, s.playhead, ['clipA']));
    const right = store
      .getState()
      .doc!.tracks[0]!.clips.find((c) => c.id !== 'clipA' && c.timelineStart === 5)!;
    store.dispatch(studioActions.selected(['clipA', right.id]));
    store.dispatch(studioActions.playheadSet(9));
    undo(store);
    expect(store.getState().playhead).toBe(9);
    expect(store.getState().selection).toEqual(['clipA']);
  });

  it('an edit to a locked track is dropped whole and raises the lock notice', () => {
    const doc = studioFixture();
    doc.tracks[0] = { ...doc.tracks[0]!, locked: true };
    const store = open(doc);
    const before = store.getState().doc;
    mutate(store, 'Volume', (d) => setClipVolume(d, 'clipA', 0.2));
    expect(store.getState().doc).toBe(before);
    expect(store.getState().lockNotice).toEqual({ trackId: doc.tracks[0]!.id, seq: 1 });
  });

  it('saved clears dirty only when nothing changed since the save started', () => {
    const store = open();
    mutate(store, 'a', (d) => setClipVolume(d, 'clipA', 0.5));
    const at = store.getState().revision;
    mutate(store, 'b', (d) => setClipVolume(d, 'clipA', 0.6));
    store.dispatch(studioActions.saved({ serverRevision: 8, atRevision: at }));
    expect(store.getState()).toMatchObject({ dirty: true, serverRevision: 8 });
    store.dispatch(
      studioActions.saved({ serverRevision: 9, atRevision: store.getState().revision }),
    );
    expect(store.getState()).toMatchObject({ dirty: false, serverRevision: 9 });
    expect(store.getState().past).toHaveLength(2); // a save never touches history
  });
});

describe('studio backend seam (previewEngine URLs)', () => {
  it('previewEngine builds app API URLs through the seam, with no credentials in the URL', () => {
    const base = getActiveStudioBackend().baseUrl;
    expect(studioProxyUrl('a1')).toBe(`${base}/studio/assets/a1/proxy`);
    expect(studioProxyUrl('a1', 2)).toBe(`${base}/studio/assets/a1/proxy?v=g2`);
    expect(studioSpriteUrl('a1')).toBe(`${base}/studio/assets/a1/sprite`);
    expect(studioPeaksUrl('a1')).toBe(`${base}/studio/assets/a1/peaks`);
    expect(studioProxyUrl('a1')).not.toMatch(/token|session|Bearer/i);
  });

  it('builds every web media route on a given origin', () => {
    const b = createAppStudioBackend('https://x.test/api');
    expect(b.proxyReversedUrl?.('z')).toBe('https://x.test/api/studio/assets/z/proxy-reversed');
    expect(b.assetFileUrl?.('z')).toBe('https://x.test/api/studio/assets/z/file');
  });
});
