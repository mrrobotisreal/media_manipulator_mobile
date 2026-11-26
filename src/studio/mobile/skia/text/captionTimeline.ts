/**
 * The caption preview's timeline (MA62 decision 9): the cues cut into segments where what is on
 * screen does not change (the generator's own Dialogue boundaries: each group, and each active
 * word for per-word animations), each segment recorded ONCE into an image at the backing size on
 * the JS thread when the captions, the style or the size change. The UI-runtime frame loop then
 * only looks the segment up by time (binary search over numbers) and draws its image as one more
 * layer above the video: no paragraph is built per frame.
 *
 * Time-varying parts inside a segment are approximated per segment: a fade is the layer's opacity,
 * from numeric fade windows per segment (`fadeIn0/1`, `fadeOut0/1`, the generator's `\fad` rule
 * computed here), the pop / bounce pulse is drawn at its peak for the first 180 / 260 ms slice and at
 * rest after it (two segments), karaoke fill switches per word. Approximate, and labelled so.
 *
 * Every image is owned here: replaced sets are retired through the compositor; `dispose()` frees
 * all of them.
 */
import type { SkImage, SkSurface } from 'react-native-skia';
import type { StudioCaptionCue, StudioCaptionStyle } from '../../../studioTypes';
import { captionFrameAt, captionGroups, cueTimedUnits, resolveCaptionLook, type CaptionLook } from './captionLayout';
import { CaptionPainter, type CaptionPainterDeps } from './captionDraw';
import { RasterSurface } from './titleRaster';

/** The recorded segments as plain arrays (what crosses to the UI runtime with the scene). */
export interface CaptionTrack {
  starts: readonly number[];
  ends: readonly number[];
  images: readonly SkImage[];
  fadeIn0: readonly number[];
  fadeIn1: readonly number[];
  fadeOut0: readonly number[];
  fadeOut1: readonly number[];
}

/** The segment showing at t, or -1 (binary search; allocation-free, runs on the UI runtime). */
export function captionIndexAt(c: CaptionTrack, t: number): number {
  'worklet';
  let lo = 0;
  let hi = c.starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (c.starts[m]! <= t) {
      found = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return found >= 0 && t < c.ends[found]! ? found : -1;
}

/** Segment i's opacity at t (1 outside its fade windows). */
export function captionAlphaAt(c: CaptionTrack, i: number, t: number): number {
  'worklet';
  let a = 1;
  const i0 = c.fadeIn0[i]!;
  const i1 = c.fadeIn1[i]!;
  const o0 = c.fadeOut0[i]!;
  const o1 = c.fadeOut1[i]!;
  if (i1 > i0 && t < i1) a = Math.min(a, (t - i0) / (i1 - i0));
  if (o1 > o0 && t > o0) a = Math.min(a, (o1 - t) / (o1 - o0));
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

export interface CaptionSegment {
  start: number;
  end: number;
  image: SkImage;
}

export interface CaptionTimelineDeps extends CaptionPainterDeps {
  makeSurface(w: number, h: number): SkSurface | null;
  retire(o: { dispose?: () => void }): void;
}

/** Segment boundaries (s): cue and group edges, word starts, and the pop / bounce settle times. */
export function captionCuts(cues: readonly StudioCaptionCue[], look: CaptionLook): number[] {
  const cuts = new Set<number>();
  const settle = look.animation === 'pop' ? 0.18 : look.animation === 'bounce' ? 0.26 : 0;
  for (const c of cues) {
    if (!(c.endSeconds > c.startSeconds)) continue;
    cuts.add(c.startSeconds);
    cuts.add(c.endSeconds);
    const { units, hasWords } = cueTimedUnits(c, look.uppercase);
    const groups = captionGroups(units, look.wordsPerGroup, hasWords);
    for (const g of groups) {
      for (let i = g[0]; i < g[1]; i += 1) {
        const s = units[i]!.start / 100;
        cuts.add(s);
        if (settle > 0) cuts.add(s + settle);
        // Karaoke and typewriter progress: a cut at each word's end too.
        cuts.add(units[i]!.end / 100);
      }
    }
  }
  return [...cuts].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

export class CaptionTimeline {
  private readonly deps: CaptionTimelineDeps;
  private readonly painter: CaptionPainter;
  private readonly surface: RasterSurface;
  private key = '';
  /** Sorted by start; the frame loop reads `starts` / `ends` / `images` by index. */
  starts: number[] = [];
  ends: number[] = [];
  images: SkImage[] = [];
  /** Per segment: opacity ramps 0 -> 1 over [fadeIn0, fadeIn1] and 1 -> 0 over [fadeOut0, fadeOut1]. */
  fadeIn0: number[] = [];
  fadeIn1: number[] = [];
  fadeOut0: number[] = [];
  fadeOut1: number[] = [];
  /** The look the segments were recorded with (the fade needs it). */
  look: CaptionLook | null = null;
  /** Recordings over the timeline's life (the "not per frame" probe). */
  recorded = 0;

  constructor(deps: CaptionTimelineDeps) {
    this.deps = deps;
    this.painter = new CaptionPainter(deps);
    this.surface = new RasterSurface(deps.makeSurface);
  }

  /** Re-records when the cues, style, enabled flag, size or fonts changed. */
  sync(
    cues: readonly StudioCaptionCue[],
    style: StudioCaptionStyle | null | undefined,
    enabled: boolean,
    W: number,
    H: number,
    projectH: number,
    fontsVersion: number,
  ): boolean {
    const key = enabled && W > 0 && H > 0 ? `${W}x${H}:${projectH}:${fontsVersion}:${JSON.stringify(style ?? null)}:${JSON.stringify(cues)}` : '';
    if (key === this.key) return false;
    this.key = key;
    this.release();
    if (!key) return true;
    const look = resolveCaptionLook(style, projectH);
    this.look = look;
    const cuts = captionCuts(cues, look);
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      const s = cuts[i]!;
      const e = cuts[i + 1]!;
      if (!(e > s)) continue;
      const mid = s + (e - s) / 2;
      // The pulse is drawn at its peak in its first slice (mid of that slice is inside the pulse).
      const f = captionFrameAt(cues, look, mid);
      if (!f) continue;
      const surface = this.surface.get(W, H);
      if (!surface) continue;
      {
        const canvas = surface.getCanvas();
        canvas.clear(this.deps.api.Color('transparent'));
        this.painter.paint(canvas, f, look, mid, W, H, projectH, 1);
        surface.flush();
        const image = surface.makeImageSnapshot();
        this.recorded += 1;
        this.starts.push(s);
        this.ends.push(e);
        this.images.push(image);
        // The group's fade windows (ass.ts: `\fad(fin, fout)` over the group, scaled down when
        // they do not fit), as absolute times; zero-length (no fade) for other animations.
        let fin = 0;
        let fout = 0;
        if (look.animation === 'fade') {
          const dur = (f.groupEnd - f.groupStart) * 1000;
          fin = look.fadeIn;
          fout = look.fadeOut;
          if (fin + fout > dur) {
            const tot = fin + fout;
            fin = Math.trunc((fin * dur) / tot);
            fout = Math.trunc((fout * dur) / tot);
          }
        }
        this.fadeIn0.push(f.groupStart);
        this.fadeIn1.push(f.groupStart + fin / 1000);
        this.fadeOut0.push(f.groupEnd - fout / 1000);
        this.fadeOut1.push(f.groupEnd);
      }
    }
    return true;
  }

  /** The arrays the frame loop reads (`CaptionTrack`, published with the scene). */
  track(): CaptionTrack {
    return {
      starts: this.starts,
      ends: this.ends,
      images: this.images,
      fadeIn0: this.fadeIn0,
      fadeIn1: this.fadeIn1,
      fadeOut0: this.fadeOut0,
      fadeOut1: this.fadeOut1,
    };
  }

  private clear(): void {
    this.starts = [];
    this.ends = [];
    this.images = [];
    this.fadeIn0 = [];
    this.fadeIn1 = [];
    this.fadeOut0 = [];
    this.fadeOut1 = [];
    this.look = null;
  }

  private release(): void {
    for (const img of this.images) this.deps.retire(img);
    this.clear();
  }

  dispose(): void {
    for (const img of this.images) {
      try {
        img.dispose();
      } catch {
        // already disposed
      }
    }
    this.clear();
    this.painter.dispose();
    this.surface.dispose();
  }
}
