/**
 * Canvas-tool state of the editor (the web's `lib/photo/toolStore.ts`, as a tiny external store so
 * the canvas overlay and the sheets share it without a provider): which touch tool is armed, the
 * brush settings, the mask view, the selected mask component, the crop aspect. Not part of the
 * document and never in undo.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_BRUSH, type BrushSettings } from '../brushEngine';
import type { AspectPreset } from '../toolMath';

export type ToolId =
  | 'none'
  | 'gradient'
  | 'radial'
  | 'brush'
  | 'eyedropper'
  | 'crop'
  | 'straighten'
  | 'perspective'
  | 'heal'
  | 'redEye';

export type MaskView = 'off' | 'overlay' | 'alpha';

export interface ToolState {
  tool: ToolId;
  brush: BrushSettings;
  maskView: MaskView;
  /** Index of the selected component in the selected layer's mask. */
  component: number;
  aspect: AspectPreset;
  /** Red-eye radius as % of the long side. */
  redEyeRadius: number;
  /** Heal brush diameter in displayed-image pixels. */
  healSize: number;
  /** Bumped when the heal strokes change (the Heal sheet shows the count). */
  healStrokes: number;
  /** "100 %" request from the Detail sheet (the canvas zooms and resets it). */
  zoomActual: number;
}

export const initialToolState = (): ToolState => ({
  tool: 'none',
  brush: { ...DEFAULT_BRUSH },
  maskView: 'off',
  component: 0,
  aspect: 'free',
  redEyeRadius: 1.5,
  healSize: 40,
  healStrokes: 0,
  zoomActual: 0,
});

export interface ToolStore {
  get(): ToolState;
  set(patch: Partial<ToolState>): void;
  setBrush(patch: Partial<BrushSettings>): void;
  subscribe(l: () => void): () => void;
  reset(): void;
}

export function createToolStore(): ToolStore {
  let state = initialToolState();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof ToolState)[];
      if (keys.every((k) => state[k] === patch[k])) return;
      state = { ...state, ...patch };
      emit();
    },
    setBrush(patch) {
      state = { ...state, brush: { ...state.brush, ...patch } };
      emit();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    reset() {
      state = initialToolState();
      emit();
    },
  };
}

export function useToolState<T>(store: ToolStore, select: (s: ToolState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

export const nextMaskView = (v: MaskView): MaskView =>
  v === 'off' ? 'overlay' : v === 'overlay' ? 'alpha' : 'off';
