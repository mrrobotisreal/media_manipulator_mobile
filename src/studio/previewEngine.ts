// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/previewEngine.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { getActiveStudioBackend } from './mobile/backend';
import { versionedProxyUrl } from './proxyRebuild';
import { valueAt } from './ease';
import { clipTimelineDuration, sourceTimeAt } from './speed';
import type {
  StudioClip,
  StudioTrack,
  StudioTrackKind,
  StudioTransform,
  StudioTransition,
  StudioTransitionType,
} from './studioTypes';

/**
 * Preview engine — the isolated "what is active at time T" logic for the
 * Content Studio timeline. This module is intentionally pure (no DOM, no React):
 * the Phase 1 preview drives a single <video>, but Phase 3 will reuse the SAME
 * resolver to position a pool of <video> elements + a Web Audio graph. Keeping
 * the resolver here means the rendering layer can be swapped (Option A pooled
 * elements → canvas/WebCodecs) without touching the timeline math.
 */

/**
 * Effective on-timeline duration of a clip: the source span divided by its
 * speed (part 17); a freeze or an unset speed is the raw span.
 */
export function clipDuration(c: StudioClip): number {
  return clipTimelineDuration(c);
}

/** On-timeline end position (seconds) of a clip. */
export function clipEnd(c: StudioClip): number {
  return c.timelineStart + clipDuration(c);
}

/** Total timeline length = end of the last clip across all tracks. */
export function timelineDuration(tracks: StudioTrack[]): number {
  let end = 0;
  for (const t of tracks) {
    for (const c of t.clips) {
      const e = clipEnd(c);
      if (e > end) end = e;
    }
  }
  return end;
}

/** A clip that is playing at time T, with its computed source position. */
export interface ActiveClip {
  clip: StudioClip;
  trackId: string;
  trackKind: StudioTrackKind;
  trackIndex: number;
  trackMuted: boolean;
  /** Where in the source media the playhead currently maps to. */
  sourceTime: number;
}

/**
 * resolveActiveClips returns at most one active clip per track at time `t`
 * (clips never overlap on a single track). The result is the complete picture
 * the renderer needs: which video clip to show, which audio clips to mix.
 */
export function resolveActiveClips(tracks: StudioTrack[], t: number): ActiveClip[] {
  const out: ActiveClip[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      const start = clip.timelineStart;
      const end = clipEnd(clip);
      if (t >= start && t < end) {
        out.push({
          clip,
          trackId: track.id,
          trackKind: track.kind,
          trackIndex: track.index,
          trackMuted: track.muted,
          sourceTime: sourceTimeAt(clip, t),
        });
        // No break: clips on a track may overlap during a cross-dissolve, so a
        // track can have two active clips. The renderer composites them.
      }
    }
  }
  return out;
}

/**
 * transitionRamp returns a clip's cross-dissolve opacity multiplier at time t:
 * ramps 0→1 across its transitionInSeconds window, then stays 1. LINEAR by
 * spec on both sides — the export's `fade=…:alpha=1` is linear too (audio
 * crossfades are the equal-power ones; see audioFadeGain). Since part 14 this
 * is the CSS-fallback/text-overlay approximation: every typed transition
 * degrades to this alpha ramp when WebGL is unavailable (documented in the
 * tolerance docs); the accurate per-type math lives in transitionFrameState.
 */
export function transitionRamp(clip: StudioClip, t: number): number {
  const d = clip.transitionInSeconds ?? 0;
  if (d <= 0) return 1;
  const into = t - clip.timelineStart;
  if (into <= 0) return 0;
  if (into >= d) return 1;
  return into / d;
}

// --- Typed transitions (part 14) ------------------------------------------
//
// A clip's `transition` describes its ENTRANCE over the overlap with its
// predecessor on the same track (overlap-pull model: the store pulls the clip
// left so the overlap equals the transition duration). Directional types share
// one rule everywhere: the direction names WHERE THE ENTERING CLIP COMES FROM
// (pushLeft/slideLeft/wipeLeft = B enters from the left edge). The Go export
// compiler (studio_export.go) mirrors this table expression-for-expression.

/**
 * clipTransitionOf resolves a clip's typed entrance transition, upgrading a
 * legacy `transitionInSeconds` to crossDissolve (mirrors Go resolveTransition
 * and normalizeProject's upgrade).
 */
export function clipTransitionOf(c: StudioClip): StudioTransition | undefined {
  if (c.transition) return c.transition;
  const legacy = c.transitionInSeconds ?? 0;
  if (legacy > 0) {
    return { type: 'crossDissolve', durationSeconds: Math.min(Math.max(legacy, 0.1), 5) };
  }
  return undefined;
}

/** Per-layer modification a transition applies at one instant. */
export interface TransitionLayerState {
  /** Opacity multiplier (1 = untouched). */
  alpha: number;
  /** Normalized offset, fraction of project width (+ = right). */
  offsetX: number;
  /** Normalized offset, fraction of project height (+ = down). */
  offsetY: number;
  /** Canvas-space fractions hidden from each edge (wipe reveal mask). */
  wipe?: { left: number; top: number; right: number; bottom: number };
}

/** Both layers' states + the optional dip color layer at one instant. */
export interface TransitionFrameState {
  /** Outgoing clip (the predecessor being transitioned away from). */
  a: TransitionLayerState;
  /** Entering clip (the one carrying the `transition` field). */
  b: TransitionLayerState;
  /** Full-canvas color layer for dips, drawn above both clips. */
  dip?: { color: 'black' | 'white'; alpha: number };
}

const IDENTITY_LAYER_STATE: TransitionLayerState = { alpha: 1, offsetX: 0, offsetY: 0 };

const clamp01p = (p: number): number => Math.max(0, Math.min(1, p));

/**
 * transitionFrameState evaluates a transition type at progress `p` (0→1 across
 * the overlap). Pure math — the single TS source of truth for how every type
 * moves/masks/fades the two clips; the WebGL compositor consumes the result
 * and the ffmpeg emitter states the same expressions:
 *  - crossDissolve: B alpha ramps linearly (A untouched underneath).
 *  - dips: a color layer peaks at p=0.5; B is hidden in the first half and
 *    fully opaque in the second (the switch happens under full color).
 *  - wipes: B revealed by a moving canvas-space crop edge, from the named edge.
 *  - pushes: A translates out while B translates in from the named edge.
 *  - slides: B translates in over a static A.
 */
export function transitionFrameState(type: StudioTransitionType, progress: number): TransitionFrameState {
  const p = clamp01p(progress);
  const a: TransitionLayerState = { ...IDENTITY_LAYER_STATE };
  const b: TransitionLayerState = { ...IDENTITY_LAYER_STATE };
  const out: TransitionFrameState = { a, b };
  switch (type) {
    case 'crossDissolve':
      b.alpha = p;
      break;
    case 'dipToBlack':
    case 'dipToWhite':
      out.dip = { color: type === 'dipToBlack' ? 'black' : 'white', alpha: 1 - Math.abs(2 * p - 1) };
      b.alpha = p < 0.5 ? 0 : 1;
      break;
    case 'wipeLeft':
      b.wipe = { left: 0, top: 0, right: 1 - p, bottom: 0 };
      break;
    case 'wipeRight':
      b.wipe = { left: 1 - p, top: 0, right: 0, bottom: 0 };
      break;
    case 'wipeUp':
      b.wipe = { left: 0, top: 0, right: 0, bottom: 1 - p };
      break;
    case 'wipeDown':
      b.wipe = { left: 0, top: 1 - p, right: 0, bottom: 0 };
      break;
    case 'pushLeft':
      b.offsetX = -(1 - p);
      a.offsetX = p;
      break;
    case 'pushRight':
      b.offsetX = 1 - p;
      a.offsetX = -p;
      break;
    case 'pushUp':
      b.offsetY = -(1 - p);
      a.offsetY = p;
      break;
    case 'pushDown':
      b.offsetY = 1 - p;
      a.offsetY = -p;
      break;
    case 'slideLeft':
      b.offsetX = -(1 - p);
      break;
    case 'slideRight':
      b.offsetX = 1 - p;
      break;
    case 'slideUp':
      b.offsetY = -(1 - p);
      break;
    case 'slideDown':
      b.offsetY = 1 - p;
      break;
    default:
      break;
  }
  return out;
}

/**
 * nextClipOnTrack returns the clip that FOLLOWS `clip` on its track in the
 * export's walking order (stable sort by timelineStart — ties keep array
 * order, matching Go's sort.SliceStable in CollectExportRefs).
 */
export function nextClipOnTrack(trackClips: StudioClip[], clip: StudioClip): StudioClip | undefined {
  const i = trackClips.indexOf(clip);
  let best = -1;
  for (let j = 0; j < trackClips.length; j += 1) {
    const c = trackClips[j];
    if (c === clip) continue;
    const after =
      c.timelineStart > clip.timelineStart ||
      (c.timelineStart === clip.timelineStart && j > i);
    if (!after) continue;
    if (
      best < 0 ||
      c.timelineStart < trackClips[best].timelineStart ||
      (c.timelineStart === trackClips[best].timelineStart && j < best)
    ) {
      best = j;
    }
  }
  return best >= 0 ? trackClips[best] : undefined;
}

/** The clip PRECEDING `clip` in the same stable order (inverse of nextClipOnTrack). */
export function prevClipOnTrack(trackClips: StudioClip[], clip: StudioClip): StudioClip | undefined {
  const i = trackClips.indexOf(clip);
  let best = -1;
  for (let j = 0; j < trackClips.length; j += 1) {
    const c = trackClips[j];
    if (c === clip) continue;
    const before =
      c.timelineStart < clip.timelineStart ||
      (c.timelineStart === clip.timelineStart && j < i);
    if (!before) continue;
    if (
      best < 0 ||
      c.timelineStart > trackClips[best].timelineStart ||
      (c.timelineStart === trackClips[best].timelineStart && j > best)
    ) {
      best = j;
    }
  }
  return best >= 0 ? trackClips[best] : undefined;
}

/** Overlap (seconds) between `clip` and its predecessor, clamped to both durations. */
export function prevClipOverlap(trackClips: StudioClip[], clip: StudioClip): number {
  const prev = prevClipOnTrack(trackClips, clip);
  if (!prev) return 0;
  const overlap = clipEnd(prev) - clip.timelineStart;
  return Math.max(0, Math.min(overlap, clipDuration(prev), clipDuration(clip)));
}

/** Overlap (seconds) between `clip` and the next clip on its track. */
export function nextClipOverlap(trackClips: StudioClip[], clip: StudioClip): number {
  const next = nextClipOnTrack(trackClips, clip);
  if (!next) return 0;
  const overlap = clipEnd(clip) - next.timelineStart;
  return Math.max(0, Math.min(overlap, clipDuration(next), clipDuration(clip)));
}

/**
 * clipTransitionState combines everything transitions do to ONE clip's layer at
 * timeline time `t`: its own entrance transition (the `.b` side) and the next
 * clip's transition pushing it out (the `.a` side). `dip` is carried only from
 * the clip's own entrance so the color layer is emitted exactly once.
 */
export function clipTransitionState(
  clip: StudioClip,
  trackClips: StudioClip[],
  t: number,
): TransitionLayerState & { dip?: { color: 'black' | 'white'; alpha: number } } {
  let alpha = 1;
  let offsetX = 0;
  let offsetY = 0;
  let wipe: TransitionLayerState['wipe'];
  let dip: { color: 'black' | 'white'; alpha: number } | undefined;

  const own = clipTransitionOf(clip);
  if (own) {
    const d = Math.min(own.durationSeconds, clipDuration(clip));
    if (d > 0 && t >= clip.timelineStart && t < clip.timelineStart + d) {
      const state = transitionFrameState(own.type, (t - clip.timelineStart) / d);
      alpha *= state.b.alpha;
      offsetX += state.b.offsetX;
      offsetY += state.b.offsetY;
      wipe = state.b.wipe;
      dip = state.dip;
    }
  }

  const next = nextClipOnTrack(trackClips, clip);
  const nextTr = next ? clipTransitionOf(next) : undefined;
  if (next && nextTr) {
    const d = Math.min(nextTr.durationSeconds, clipDuration(next));
    if (d > 0 && t >= next.timelineStart && t < next.timelineStart + d) {
      const state = transitionFrameState(nextTr.type, (t - next.timelineStart) / d);
      alpha *= state.a.alpha;
      offsetX += state.a.offsetX;
      offsetY += state.a.offsetY;
    }
  }

  return { alpha, offsetX, offsetY, wipe, dip };
}

/**
 * audioFadeGain evaluates the clip's audio crossfade multiplier at timeline
 * time `t`, using the SAME equal-power (qsin) curve as the export's
 * `afade=…:curve=qsin`: fade-in gain = sin(x·π/2), fade-out gain =
 * sin((1−x)·π/2), x being 0→1 progress through the fade window. Since part 14
 * the windows derive from the ACTUAL same-track overlaps (not the declared
 * transition): whenever two audio-bearing clips overlap on one track the
 * crossfade is automatic and first-class, no user action required — mirroring
 * CollectExportRefs' overlap-derived FadeIn/FadeOut. Fade-out is skipped when
 * it would cover the whole clip, like the export. Video alpha dissolves
 * intentionally stay LINEAR on both sides — see transitionRamp.
 */
export function audioFadeGain(clip: StudioClip, trackClips: StudioClip[], t: number): number {
  const dur = clipDuration(clip);
  if (dur <= 0) return 1;
  const x = t - clip.timelineStart;
  let g = 1;
  const fadeIn = Math.min(prevClipOverlap(trackClips, clip), dur);
  if (fadeIn > 0 && x < fadeIn) {
    g *= Math.sin((Math.PI / 2) * Math.max(0, x / fadeIn));
  }
  const fadeOut = Math.min(nextClipOverlap(trackClips, clip), dur);
  if (fadeOut > 0 && dur > fadeOut && x > dur - fadeOut) {
    const p = Math.min(1, (x - (dur - fadeOut)) / fadeOut);
    g *= Math.sin((Math.PI / 2) * (1 - p));
  }
  return g;
}

/**
 * cssFilterForAdjustments builds the CSS `filter` string that fakes the export's
 * `eq` color adjustments in preview. Our model: brightness -1..1 (additive,
 * mapped to CSS 1+b), contrast/saturation 0..2 (1 = none, used directly).
 */
export function cssFilterForAdjustments(a?: {
  brightness: number;
  contrast: number;
  saturation: number;
}): string {
  if (!a) return 'none';
  const b = 1 + (a.brightness ?? 0);
  const c = a.contrast ?? 1;
  const s = a.saturation ?? 1;
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

/**
 * topVideoClip picks the video clip that should be visible at time T: the one on
 * the highest-indexed (top-most) video track among the active clips. Phase 1
 * only ever has one video track, so this returns that clip; Phase 3 uses the
 * index to composite overlays.
 */
export function topVideoClip(active: ActiveClip[]): ActiveClip | undefined {
  let top: ActiveClip | undefined;
  for (const a of active) {
    if (a.trackKind !== 'video') continue;
    if (!top || a.trackIndex > top.trackIndex) top = a;
  }
  return top;
}

// --- Browser-facing URLs for ingested derivatives -------------------------
// These are stable per-asset passthrough routes (not presigned), so they don't
// expire mid-session and play back through the API's CORS headers. They resolve
// against the active StudioBackend so the decoder pool, waveforms, and LUT
// loads hit the correct origin (MM api vs CreaTV transcoding api).

/**
 * Preview proxy URL. `generation` (MM71, the asset's `proxyGeneration`)
 * versions it (`?v=g<N>`) so a rebuilt proxy is never answered from the
 * week-long browser cache of the old one; 0/absent keeps the bare URL.
 */
export function studioProxyUrl(assetId: string, generation?: number): string {
  return versionedProxyUrl(getActiveStudioBackend().proxyUrl(assetId), generation);
}

/** Reversed preview proxy (part 17), or '' when the backend has none. Versioned like the proxy (MM71). */
export function studioProxyReversedUrl(assetId: string, generation?: number): string {
  return versionedProxyUrl(getActiveStudioBackend().proxyReversedUrl?.(assetId) ?? '', generation);
}

export function studioSpriteUrl(assetId: string): string {
  return getActiveStudioBackend().spriteUrl(assetId);
}

/** Waveform peaks URL, or '' when the active backend doesn't serve /peaks. */
export function studioPeaksUrl(assetId: string): string {
  return getActiveStudioBackend().peaksUrl?.(assetId) ?? '';
}

/** Raw original-file passthrough (.cube LUT assets), or '' when unsupported. */
export function studioAssetFileUrl(assetId: string): string {
  return getActiveStudioBackend().assetFileUrl?.(assetId) ?? '';
}

/**
 * volumeAtClipTime evaluates a clip's effective gain at `clipLocalSeconds`
 * (seconds from the clip's timeline start). Since part 15 the v3
 * `keyframes.volume` lane wins (eased interpolation via the shared curve
 * contract in ease.ts, matching the export's generalized volume expression);
 * the legacy `volumeKeyframes` piecewise-linear path stays for documents the
 * store hasn't touched. With neither, the flat volume (default 1). Keyframes
 * are assumed sorted (the store normalizes on write).
 */
export function volumeAtClipTime(clip: StudioClip, clipLocalSeconds: number): number {
  const lane = clip.keyframes?.volume;
  if (lane && lane.length > 0) return valueAt(lane, clipLocalSeconds, clip.volume ?? 1);
  const kfs = clip.volumeKeyframes;
  if (!kfs || kfs.length === 0) return clip.volume ?? 1;
  if (clipLocalSeconds <= kfs[0].t) return kfs[0].gain;
  const last = kfs[kfs.length - 1];
  if (clipLocalSeconds >= last.t) return last.gain;
  for (let i = 1; i < kfs.length; i += 1) {
    const b = kfs[i];
    if (clipLocalSeconds <= b.t) {
      const a = kfs[i - 1];
      const span = b.t - a.t;
      if (span <= 0) return b.gain;
      const f = (clipLocalSeconds - a.t) / span;
      return a.gain + (b.gain - a.gain) * f;
    }
  }
  return last.gain;
}

// --- Keyframed property resolver (part 15) ---------------------------------

/** Effective per-frame values for one clip: keyframed where a lane exists, the static field otherwise. */
export interface ClipValues {
  /** Effective 2D transform (identity-based when the clip has none). */
  transform: StudioTransform;
  /** Effective opacity 0..1 (transition alpha NOT included). */
  opacity: number;
  /** Effective audio gain 0..2. */
  volume: number;
  /** Effective stereo balance −1..1. */
  pan: number;
  /** Keyframed effect-param overrides, keyed "<effectId>.<param>". Only keyframed params appear. */
  effects?: Record<string, number>;
}

/**
 * clipValuesAt resolves everything animatable on a clip at clip-local time
 * `t` (seconds from the clip's timeline start): the keyframed value where a
 * `keyframes.<prop>` lane exists, else the static field. The preview surface
 * calls this once per active clip per frame and feeds the results into the
 * WebGL uniforms + Web Audio nodes; the Go export emits expressions/sendcmd
 * lines that evaluate the SAME curves (ease.ts is the contract).
 */
export function clipValuesAt(clip: StudioClip, t: number): ClipValues {
  const k = clip.keyframes;
  const base = clip.transform;
  const transform: StudioTransform = {
    x: k?.positionX?.length ? valueAt(k.positionX, t) : base?.x ?? 0,
    y: k?.positionY?.length ? valueAt(k.positionY, t) : base?.y ?? 0,
    scale: k?.scale?.length ? valueAt(k.scale, t) : base?.scale ?? 1,
    rotationDeg: k?.rotation?.length ? valueAt(k.rotation, t) : base?.rotationDeg ?? 0,
  };
  const out: ClipValues = {
    transform,
    opacity: k?.opacity?.length ? valueAt(k.opacity, t) : clip.opacity ?? 1,
    volume: volumeAtClipTime(clip, t),
    pan: k?.pan?.length ? valueAt(k.pan, t) : clip.pan ?? 0,
  };
  if (k?.effects) {
    const effects: Record<string, number> = {};
    let any = false;
    for (const [key, lane] of Object.entries(k.effects)) {
      if (lane.length === 0) continue;
      effects[key] = valueAt(lane, t);
      any = true;
    }
    if (any) out.effects = effects;
  }
  return out;
}
