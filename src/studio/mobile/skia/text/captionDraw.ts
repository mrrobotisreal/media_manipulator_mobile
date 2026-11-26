/**
 * Draws the approximate caption preview (MA62 decision 9) for one `CaptionFrame` onto a canvas at
 * the compositor's backing size: one Skia paragraph per pass (shadow, outline, fill), wrapped at
 * the style's `maxWidthPct` and aligned to the style's position like the ASS style (alignment 2 / 5
 * / 8, 5 % vertical margin). Per look: `box` = one plate behind the block (BorderStyle 4), `word_box`
 * / `box_highlight` = a box behind the active word, `none` = outline + shadow only. Animations from
 * `captionLayout.ts`: fade alpha, the active word's colour (highlight / pop / bounce / karaoke fill
 * / glow outline), its scale pulse (pop / bounce; approximated by enlarging the word's font size,
 * not a per-glyph transform), hidden words (word_by_word / typewriter reveal).
 *
 * The CaptionPainter keeps the paints it reuses; the paragraphs of one frame are built and disposed
 * in `paint()`, and `paint()` runs only when the caption frame changes (a new word, group or fade
 * step), not per video frame: the preview records the result into a picture (`StudioPreview`).
 */
import type { SkCanvas, SkParagraph, SkTypefaceFontProvider } from 'react-native-skia';
import type { SkiaApi } from '../compositor/compositor';
import { activeScale, captionFade, type CaptionFrame, type CaptionLook } from './captionLayout';
import { FALLBACK } from './fonts';

const STYLE_FILL = 0;
const STYLE_STROKE = 1;
const JOIN_ROUND = 1;
const ALIGN_CENTER = 2;

export interface CaptionPainterDeps {
  api: SkiaApi;
  fonts: SkTypefaceFontProvider;
  onParagraph?: (p: SkParagraph) => void;
}

function rgba(api: SkiaApi, css: string, alpha: number) {
  const c = api.Color(css);
  const out = new Float32Array(4);
  out[0] = c[0]!;
  out[1] = c[1]!;
  out[2] = c[2]!;
  out[3] = c[3]! * Math.max(0, Math.min(1, alpha));
  return out;
}

export class CaptionPainter {
  private readonly deps: CaptionPainterDeps;
  private readonly fill;
  private readonly stroke;
  private readonly box;
  /** Paragraphs built over the painter's life (the leak test's probe). */
  built = 0;

  constructor(deps: CaptionPainterDeps) {
    this.deps = deps;
    this.fill = deps.api.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setStyle(STYLE_FILL);
    this.stroke = deps.api.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(STYLE_STROKE);
    this.stroke.setStrokeJoin(JOIN_ROUND);
    this.box = deps.api.Paint();
    this.box.setAntiAlias(true);
    this.box.setStyle(STYLE_FILL);
  }

  /**
   * The block as a paragraph in one pass (`pass`: fill colours per word, or one colour for the
   * stroke / shadow passes). Hidden words keep their space (transparent), so nothing reflows as
   * words are revealed, like libass with `\1a&HFF&`.
   */
  private block(
    f: CaptionFrame,
    look: CaptionLook,
    t: number,
    scale: number,
    width: number,
    pass: 'fill' | 'stroke' | 'shadow',
    alpha: number,
  ): SkParagraph {
    const { api } = this.deps;
    const px = look.fontSize * scale;
    const builder = api.ParagraphBuilder.Make({ textAlign: ALIGN_CENTER }, this.deps.fonts);
    const weight = look.bold ? 700 : 400;
    const highlightActive = ['highlight', 'pop', 'bounce'].includes(look.animation);
    const [sx] = f.active >= 0 ? activeScale(look, f.intoActive) : [1];
    for (let i = 0; i < f.words.length; i += 1) {
      const w = f.words[i]!;
      const isActive = i === f.active;
      const sep = i > 0 ? (/[\n\r]/.test(w.sep) ? '\n' : w.sep ? ' ' : '') : '';
      let color = look.color;
      if (pass === 'fill') {
        if (w.emphasis || (isActive && highlightActive)) color = look.highlight;
        if (look.animation === 'karaoke_fill' && f.progress[i]! > 0) color = look.highlight;
      } else if (pass === 'stroke') {
        color = look.animation === 'glow' && isActive ? look.highlight : look.outlineColor;
      } else {
        color = look.backgroundColor;
      }
      const a = f.revealed[i] ? alpha * (pass === 'shadow' ? look.backgroundOpacity : 1) : 0;
      const paint = pass === 'stroke' ? this.stroke : this.fill;
      const size = isActive ? px * sx : px;
      if (sep) {
        builder.pushStyle({ fontFamilies: [f.family, FALLBACK], fontSize: px, fontStyle: { weight }, color: rgba(api, color, 0) });
        builder.addText(sep);
        builder.pop();
      }
      paint.setColor(rgba(api, color, a));
      if (pass === 'stroke') {
        const w2 = isActive && look.animation === 'glow' ? Math.max(look.outlinePx, (2 + 4 * look.strength) * scale) : look.outlinePx * scale;
        paint.setStrokeWidth(w2 * 2);
      }
      builder.pushStyle({ fontFamilies: [f.family, FALLBACK], fontSize: size, fontStyle: { weight } }, paint);
      builder.addText(w.text);
      builder.pop();
    }
    const p = builder.build();
    try {
      builder.dispose();
    } catch {
      // the paragraph holds what it needs
    }
    p.layout(width);
    this.built += 1;
    this.deps.onParagraph?.(p);
    void t;
    return p;
  }

  /**
   * Draws `f` at time `t` onto `canvas` (W x H = the backing size; the project is `projectH` tall).
   * `alphaOverride`: draw at this opacity instead of the fade at `t` (the timeline records each
   * segment once at full opacity and fades it when drawing).
   */
  paint(
    canvas: SkCanvas,
    f: CaptionFrame,
    look: CaptionLook,
    t: number,
    W: number,
    H: number,
    projectH: number,
    alphaOverride?: number,
  ): void {
    const { api } = this.deps;
    const scale = H / projectH;
    const alpha = alphaOverride ?? captionFade(look, f, t);
    if (alpha <= 0) return;
    const width = (W * look.maxWidthPct) / 100;
    const own: SkParagraph[] = [];
    try {
      const fill = this.block(f, look, t, scale, width, 'fill', alpha);
      own.push(fill);
      const h = fill.getHeight();
      const margin = H * 0.05;
      const top = look.position === 'top' ? margin : look.position === 'middle' ? (H - h) / 2 : H - margin - h;
      const left = (W - width) / 2;
      if (look.bgMode === 'box') {
        const lw = fill.getLongestLine();
        const pad = look.boxPad * scale;
        this.box.setColor(rgba(api, look.backgroundColor, look.backgroundOpacity * alpha));
        canvas.drawRect(api.XYWHRect((W - lw) / 2 - pad, top - pad, lw + 2 * pad, h + 2 * pad), this.box);
      } else {
        if ((look.bgMode === 'word_box' || look.animation === 'box_highlight') && f.active >= 0) {
          // A box behind the active word, from the fill paragraph's own glyph rects.
          let from = 0;
          for (let i = 0; i < f.active; i += 1) from += (i > 0 && f.words[i]!.sep ? 1 : 0) + f.words[i]!.text.length;
          if (f.active > 0 && f.words[f.active]!.sep) from += 1;
          const rects = fill.getRectsForRange(from, from + f.words[f.active]!.text.length);
          const pad = look.boxPad * scale;
          this.box.setColor(rgba(api, look.highlight, alpha));
          for (const r of rects) canvas.drawRect(api.XYWHRect(left + r.x - pad, top + r.y - pad / 2, r.width + 2 * pad, r.height + pad), this.box);
        }
        if (look.shadowPx > 0) {
          const sh = this.block(f, look, t, scale, width, 'shadow', alpha);
          own.push(sh);
          sh.paint(canvas, left + look.shadowPx * scale, top + look.shadowPx * scale);
        }
      }
      if (look.outlinePx > 0 || look.animation === 'glow') {
        const st = this.block(f, look, t, scale, width, 'stroke', alpha);
        own.push(st);
        st.paint(canvas, left, top);
      }
      fill.paint(canvas, left, top);
    } finally {
      for (const p of own) {
        try {
          p.dispose();
        } catch {
          // already disposed
        }
      }
    }
  }

  dispose(): void {
    for (const p of [this.fill, this.stroke, this.box]) {
      try {
        p.dispose();
      } catch {
        // already disposed
      }
    }
  }
}
