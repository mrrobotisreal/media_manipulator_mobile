// DO NOT EDIT. Copied from media-manipulator-ui parity-harness/capture/buildLayers.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { GLCompositor, GLLayer } from './glCompositor';
import {
  clipTransitionState,
  clipValuesAt,
  resolveActiveClips,
  type ActiveClip,
} from '../previewEngine';
import type { StudioTrack } from '../studioTypes';

/**
 * EDL → GLLayer[] for one timeline instant, for the parity capture page.
 *
 * MIRROR WARNING: this reproduces the editor's layer construction —
 * `buildGLLayer` + the zOf ordering in
 * components/content-studio/preview-surface.tsx (which cannot be imported here
 * without dragging the whole React editor into the capture bundle). If that
 * file changes how layers are built or ordered, change this in lockstep.
 * The ordering (trackIndex asc, then timelineStart asc) equals the export's
 * sortVideoSegs in studio_export.go.
 */

// hexToRgb01 — same conversion as preview-surface.tsx.
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) return [0, 1, 0];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export interface LayerSource {
  slot: number;
  srcW: number;
  srcH: number;
  /** Title clips (part 16): GL image-texture id instead of a pool slot. */
  imageKey?: string;
}

/** Video clips active at `t`, in composite (bottom→top) order. */
export function orderedVideoClips(tracks: StudioTrack[], t: number): ActiveClip[] {
  const hidden = new Set(tracks.filter((tr) => tr.kind === 'video' && tr.hidden).map((tr) => tr.id));
  return resolveActiveClips(tracks, t)
    .filter((a) => a.trackKind === 'video' && !hidden.has(a.trackId))
    .sort((x, y) => x.trackIndex - y.trackIndex || x.clip.timelineStart - y.clip.timelineStart);
}

/**
 * Builds the compositor layers for the active clips. `sources` maps clip id →
 * uploaded slot + source dimensions (the caller has already seeked/uploaded).
 * `tracks` and the project dimensions feed the typed-transition state (part
 * 14): entrance/push-out mods per clip plus full-canvas dip color layers.
 */
export function buildLayersAtTime(
  active: ActiveClip[],
  tracks: StudioTrack[],
  t: number,
  sources: Map<string, LayerSource>,
  comp: GLCompositor,
  projectW: number,
  projectH: number,
): GLLayer[] {
  const layers: GLLayer[] = [];
  for (const a of active) {
    const src = sources.get(a.clip.id);
    if (!src) continue;
    const clip = a.clip;
    const eq = clip.adjustments
      ? {
          brightness: clip.adjustments.brightness,
          contrast: clip.adjustments.contrast,
          saturation: clip.adjustments.saturation,
        }
      : undefined;
    // Part 15: per-frame keyframed values via the shared resolver — the same
    // clipValuesAt the editor's buildGLLayer consumes.
    const values = clipValuesAt(clip, t - clip.timelineStart);
    const ov = (effectId: string, param: string, fallback: number): number =>
      values.effects?.[`${effectId}.${param}`] ?? fallback;
    let lumetri: GLLayer['lumetri'];
    let lut: GLLayer['lut'];
    let chroma: GLLayer['chroma'];
    for (const e of clip.effects ?? []) {
      if (!e.enabled) continue;
      if (e.type === 'lumetri' && !lumetri) {
        lumetri = {
          exposure: ov(e.id, 'exposure', e.exposure),
          contrast: ov(e.id, 'contrast', e.contrast),
          saturation: ov(e.id, 'saturation', e.saturation),
          temperature: ov(e.id, 'temperature', e.temperature),
          tint: ov(e.id, 'tint', e.tint),
          vibrance: ov(e.id, 'vibrance', e.vibrance),
        };
      } else if (e.type === 'lut' && !lut && comp.hasLut(e.lutAssetId)) {
        lut = { key: e.lutAssetId, intensity: ov(e.id, 'intensity', e.intensity) };
      } else if (e.type === 'chromakey' && !chroma) {
        chroma = {
          keyColor: hexToRgb01(e.keyColor),
          similarity: ov(e.id, 'similarity', e.similarity),
          blend: ov(e.id, 'blend', e.blend),
          despill: ov(e.id, 'despill', e.despill),
        };
      }
    }
    // Typed transition state (part 14): mirrors buildGLLayer + the dip-layer
    // emission in preview-surface.tsx exactly.
    const trackClips = tracks.find((tr) => tr.id === a.trackId)?.clips ?? [];
    const trs = clipTransitionState(clip, trackClips, t);
    const transform = {
      x: values.transform.x + trs.offsetX,
      y: values.transform.y + trs.offsetY,
      scale: values.transform.scale,
      rotationDeg: values.transform.rotationDeg,
    };
    layers.push({
      slot: src.slot,
      imageKey: src.imageKey,
      srcW: src.srcW,
      srcH: src.srcH,
      transform,
      crop: clip.crop,
      opacity: values.opacity * trs.alpha,
      blendMode: clip.blendMode,
      eq,
      lumetri,
      lut,
      chroma,
      wipe: trs.wipe,
    });
    if (trs.dip && trs.dip.alpha > 0) {
      layers.push({
        slot: -1,
        srcW: projectW,
        srcH: projectH,
        opacity: trs.dip.alpha,
        solid: trs.dip.color === 'black' ? [0, 0, 0] : [1, 1, 1],
      });
    }
  }
  return layers;
}
