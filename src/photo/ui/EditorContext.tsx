/**
 * What every sheet needs: the editor store (read with `usePhotoSelector`, write with `edit`), the
 * gesture bracket for sliders, and the adjustment analytics seam. Provided by the editor screen;
 * tests provide a plain store.
 */
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { mutate, photoActions, type PhotoState, type PhotoStore } from '../photoStore';
import type { PhotoDoc } from '../photoTypes';
import type { Snapshots } from '../history';
import type { Histogram256 } from '../presets/presetStore';
import type { ToolStore } from '../tools/toolState';

/** MA51: what the masks / geometry / heal / detail / presets / history sheets reach for. */
export interface EditorTools {
  tools: ToolStore;
  snapshots: Snapshots;
  /** Original-pixel size of the source the doc describes. */
  sourceSize: { width: number; height: number };
  capabilities?: { aiMasks: boolean; heal: boolean };
  /** "Select subject" on the selected layer (the server route; resolves when installed). */
  selectSubject?: (layerId: string) => Promise<void>;
  subjectBusy?: boolean;
  /** The Heal press with the recorded spot strokes. */
  heal?: () => Promise<void>;
  healState?: { phase: 'idle' | 'running' | 'failed'; progress: number };
  clearHealStrokes?: () => void;
  /** 256-bin histogram of the current preview (Auto preset). */
  histogram256?: () => Histogram256 | null;
  /** A 96 px preview of the photo with `layers` appended (preset thumbnails). */
  presetThumb?: (
    key: string,
    layers: import('../photoTypes').AdjustmentLayer[],
  ) => import('@shopify/react-native-skia').SkImage | null;
  /** Analytics seams (names live in the analytics mirror). */
  onPresetApplied?: (id: string, builtin: boolean) => void;
}

export interface EditorApi {
  store: PhotoStore;
  /** A layer param was touched (debounced `photo_adjustment_changed`; keys only). */
  noteAdjustment?: (type: string, param: string) => void;
  haptics?: boolean;
  /** MA51 sheets; absent in MA50's sheet tests. */
  extra?: EditorTools;
}

const Ctx = createContext<EditorApi | null>(null);
export const EditorProvider = Ctx.Provider;

/** The MA51 sheets' tools; throws outside a full editor. */
export function useEditorTools(): EditorTools {
  const v = useContext(Ctx);
  if (!v?.extra) throw new Error('useEditorTools outside the editor');
  return v.extra;
}

export function useEditor(): EditorApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEditor outside EditorProvider');
  return v;
}

/** Subscribe a component to one slice of the editor state (re-renders only when it changes). */
export function usePhotoSelector<T>(select: (s: PhotoState) => T): T {
  const { store } = useEditor();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export function useEdit() {
  const { store, noteAdjustment } = useEditor();
  const edit = useCallback(
    (label: string, fn: (d: PhotoDoc) => PhotoDoc, note?: [string, string]) => {
      mutate(store, label, fn);
      if (note) noteAdjustment?.(note[0], note[1]);
    },
    [store, noteAdjustment],
  );
  const begin = useCallback(
    (label: string) => store.dispatch(photoActions.gestureBegan(label)),
    [store],
  );
  const end = useCallback(() => store.dispatch(photoActions.gestureEnded()), [store]);
  return { edit, begin, end };
}
