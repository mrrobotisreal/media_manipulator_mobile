/**
 * What every sheet needs: the editor store (read with `usePhotoSelector`, write with `edit`), the
 * gesture bracket for sliders, and the adjustment analytics seam. Provided by the editor screen;
 * tests provide a plain store.
 */
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { mutate, photoActions, type PhotoState, type PhotoStore } from '../photoStore';
import type { PhotoDoc } from '../photoTypes';

export interface EditorApi {
  store: PhotoStore;
  /** A layer param was touched (debounced `photo_adjustment_changed`; keys only). */
  noteAdjustment?: (type: string, param: string) => void;
  haptics?: boolean;
}

const Ctx = createContext<EditorApi | null>(null);
export const EditorProvider = Ctx.Provider;

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
