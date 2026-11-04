/**
 * History sheet model (ticket MA51 decision 9; the web's `lib/photo/history.ts`): the editor
 * store's undo stack as a timeline, every `mutate` label mapped to a translation key, and session
 * snapshots. Labels are the short keys the sheets pass to `edit(label, …)`; the registry below is
 * the closed list (a test greps the code for every label and checks it resolves).
 *
 * Keys reuse the web shard `interface:photo.history.labels.*` and the layer type names; the few
 * phone-only labels are app keys under `photo.history.*`.
 */
import { LAYER_TYPES, type PhotoDoc } from './photoTypes';
import type { PhotoHistoryEntry } from './photoStore';

/** Web `photo.history.labels.<slug>` slugs the phone uses as labels directly. */
export const WEB_HISTORY_LABELS = [
  'addMask',
  'autoCrop',
  'brush',
  'colourTarget',
  'crop',
  'deleteGroup',
  'fill',
  'flip',
  'heal',
  'invertMask',
  'mask',
  'maskFeather',
  'maskOpacity',
  'perspective',
  'removeMask',
  'removeMaskComponent',
  'resetCrop',
  'resetPerspective',
  'restoreDraft',
  'rotate',
  'selectSubject',
  'snapshot',
  'straighten',
  'grayExcept',
  'reset',
] as const;

/** MA50's short labels → their web slug (or an app key). */
export const LABEL_ALIASES: Record<string, string> = {
  reorder: 'interface:photo.history.labels.reorderLayers',
  layer: 'interface:photo.history.labels.toggleLayer',
  opacity: 'interface:photo.history.labels.layerOpacity',
  blend: 'interface:photo.history.labels.blendMode',
  duplicate: 'interface:photo.history.labels.duplicateLayer',
  delete: 'interface:photo.history.labels.deleteLayer',
  export: 'photo.history.exportSettings',
  source: 'photo.history.source',
};

export type LabelResolution =
  | { key: string; vars?: Record<string, string> }
  | { presetBuiltin: string }
  | { presetUser: string };

/** Structured preset labels, like the web: `Preset|builtin:<id>`, `Preset|user:<name>`. */
export const presetLabel = (builtin: boolean, idOrName: string) =>
  `Preset|${builtin ? 'builtin' : 'user'}:${idOrName}`;

export function resolveLabel(label: string): LabelResolution | null {
  if (label.startsWith('Preset|builtin:')) return { presetBuiltin: label.slice(15) };
  if (label.startsWith('Preset|user:')) return { presetUser: label.slice(12) };
  if ((LAYER_TYPES as readonly string[]).includes(label))
    return { key: `interface:photo.layers.type.${label}` };
  if ((WEB_HISTORY_LABELS as readonly string[]).includes(label))
    return { key: `interface:photo.history.labels.${label}` };
  const alias = LABEL_ALIASES[label];
  return alias ? { key: alias } : null;
}

/** Every label the registry knows (the coverage test checks the code's labels against it). */
export const isKnownLabel = (label: string) => resolveLabel(label) !== null;

export interface HistoryStep {
  /** Timeline state this step lands on (1-based; 0 is the opened document). */
  index: number;
  label: string;
  applied: boolean;
  current: boolean;
}

export function historySteps(
  past: PhotoHistoryEntry[],
  future: PhotoHistoryEntry[],
): HistoryStep[] {
  const n = past.length;
  const out: HistoryStep[] = past.map((e, i) => ({
    index: i + 1,
    label: e.label,
    applied: true,
    current: i + 1 === n,
  }));
  for (let k = future.length - 1; k >= 0; k -= 1)
    out.push({
      index: n + (future.length - k),
      label: future[k]!.label,
      applied: false,
      current: false,
    });
  return out;
}

/** Undo (negative) or redo (positive) steps to reach timeline state `target` from `past.length`. */
export const stepsTo = (pastLength: number, target: number) => target - pastLength;

export interface Snapshot {
  id: string;
  name: string;
  doc: PhotoDoc;
}

/** Session-only bookmarks (not saved in the document), like the web. */
export function createSnapshots() {
  let list: Snapshot[] = [];
  let counter = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => list,
    add(name: string, doc: PhotoDoc): Snapshot {
      counter += 1;
      const snap = { id: `snap-${counter}`, name: name.trim().slice(0, 60), doc };
      list = [...list, snap];
      emit();
      return snap;
    },
    remove(id: string) {
      list = list.filter((s) => s.id !== id);
      emit();
    },
    clear() {
      list = [];
      emit();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
export type Snapshots = ReturnType<typeof createSnapshots>;
