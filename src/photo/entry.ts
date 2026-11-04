/**
 * Applying an MA52 entry row's look when the editor opens (the web's `pendingEntry` in
 * `components/photo/editor.tsx`): the built-in preset's layers appended as one undoable group,
 * labelled like a look picked in the Looks sheet. Computed presets (Auto) need the preview
 * histogram, so an entry never names one. Pure over the store, tested.
 */
import { presetLabel } from './history';
import { applyPreset, builtinLayers } from './presets/presetStore';
import { mutate, type PhotoStore } from './photoStore';

/** True when the look was applied (a known, non-empty built-in and a loaded doc). */
export function applyEntryPreset(
  store: PhotoStore,
  presetId: string,
  displayName: string,
): boolean {
  const layers = builtinLayers(presetId, null);
  if (!layers || layers.length === 0 || !store.getState().doc) return false;
  const before = store.getState().doc;
  mutate(store, presetLabel(true, presetId), (d) => applyPreset(d, presetId, layers, displayName));
  return store.getState().doc !== before;
}
