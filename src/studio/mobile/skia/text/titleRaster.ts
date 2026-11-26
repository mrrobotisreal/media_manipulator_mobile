/**
 * Darkroom title clips on the phone (ticket MA62 decision 8): the port of the web's `rasterTitle`
 * (media-manipulator-ui `lib/studio/titleRaster.ts`, copied byte for byte to `src/studio/titleRaster.ts`)
 * from Canvas 2D to Skia, drawing the layer stack (rect, line, text) into an offscreen surface at
 * the compositor's backing size. The snapshot then flows through the same per-clip chain as video
 * (`compositor.ts`, transform / opacity / keyframes / transitions), exactly like the web's uploaded
 * title canvas.
 *
 * What is shared, not re-stated: the SHARED TITLE LAYOUT SPEC lives in the copied file and is
 * called here: `layoutTitleText` (lines on '\n', anchor, line height, block centring), `lineExtent`
 * (the align rule for plates), `sanitizeTitleFontFamily` / `effectiveTitleFontWeight` (titleFonts.ts),
 * and `titleRasterKey` (the cache key, `titleRasters.ts`). Only the drawing calls are the port:
 * - `ctx.fillText(line, x, centerY)` with `textBaseline = 'middle'`: a Skia Paragraph per line, its
 *   alphabetic baseline put where Blink's canvas puts it for 'middle' (half the normalised OS/2
 *   typo ascent minus descent below the centre; `fontMetrics.ts`); `textAlign` = the paragraph's
 *   x offset from the measured width (`lineExtent`'s rule);
 * - `letterSpacing` = the paragraph's `letterSpacing`; the shadow pass = a text shadow with blur
 *   sigma = shadowBlur / 2 (the canvas spec's definition); the outer stroke = a stroke-paint
 *   paragraph at 2 x strokeWidthPx with round joins, then the fill on top (the web's 3 passes);
 * - rect / line / background plates: `drawRRect` / `drawLine` with the same geometry and alpha.
 *
 * Every Skia object made here (paragraphs, paints, the surface) is disposed before returning; the
 * returned image is the caller's (`titleRasters.ts` retires it through the compositor).
 */
import type {
  SkCanvas,
  SkImage,
  SkParagraph,
  SkPaint,
  SkSurface,
  SkTypefaceFontProvider,
} from 'react-native-skia';
import { layoutTitleText, lineExtent } from '../../../titleRaster';
import { effectiveTitleFontWeight, sanitizeTitleFontFamily } from '../../../titleFonts';
import type {
  StudioTitle,
  StudioTitleLineLayer,
  StudioTitleRectLayer,
  StudioTitleTextLayer,
} from '../../../studioTypes';
import type { SkiaApi } from '../compositor/compositor';
import { FONT_METRICS } from './fontMetrics';
import { FALLBACK } from './fonts';

// Numeric enums (a worklet module must not import RN Skia at runtime).
const STYLE_FILL = 0;
const STYLE_STROKE = 1;
const CAP_BUTT = 0;
const JOIN_ROUND = 1;
const TEXT_ALIGN_LEFT = 0;

/** Paragraph layout width for one unwrapped line (the web never wraps: lines split on '\n' only). */
const NO_WRAP = 1e6;

/**
 * Where Blink's canvas puts the alphabetic baseline for `textBaseline = 'middle'`, below the given
 * y, for a font of `px`: (a - d) / 2 with a + d = px, a : d = the OS/2 typo ascender : descender
 * (`NormalizedTypoAscentAndDescent`), hhea when the typo metrics are missing.
 */
export function middleBaselineOffset(family: string, weight: number, px: number): number {
  const byWeight = FONT_METRICS[family] ?? FONT_METRICS[FALLBACK]!;
  const m = byWeight[weight] ?? byWeight[400] ?? Object.values(byWeight)[0]!;
  let asc = m[1];
  let desc = -m[2];
  if (!(asc > 0 && desc >= 0)) {
    asc = m[3];
    desc = -m[4];
  }
  const total = asc + desc;
  if (!(total > 0)) return 0;
  const a = (px * asc) / total;
  const d = px - a;
  return (a - d) / 2;
}

export interface TitleRasterDeps {
  api: SkiaApi;
  fonts: SkTypefaceFontProvider;
  /**
   * A surface of w x h to draw into, BORROWED: the caller keeps one per size and disposes it
   * (`RasterSurface`), so rastering does not churn GPU textures. The result is a snapshot copy.
   */
  surface(w: number, h: number): SkSurface | null;
  /** Paragraphs made while rastering (the leak test's probe). */
  onParagraph?: (p: SkParagraph) => void;
}

interface Owned {
  dispose?: () => void;
}
const disposeAll = (xs: Owned[]) => {
  for (let i = xs.length - 1; i >= 0; i -= 1) {
    try {
      xs[i]!.dispose?.();
    } catch {
      // already disposed
    }
  }
  xs.length = 0;
};

function colorWithAlpha(api: SkiaApi, css: string, alpha: number) {
  const c = api.Color(css);
  // SkColor is a Float32Array RGBA on both platforms: scale its alpha like canvas globalAlpha.
  const out = new Float32Array(4);
  out[0] = c[0]!;
  out[1] = c[1]!;
  out[2] = c[2]!;
  out[3] = c[3]! * (alpha < 0 ? 0 : alpha > 1 ? 1 : alpha);
  return out;
}

function fillPaint(api: SkiaApi, css: string, alpha: number, own: Owned[]): SkPaint {
  const p = api.Paint();
  own.push(p);
  p.setAntiAlias(true);
  p.setStyle(STYLE_FILL);
  p.setColor(colorWithAlpha(api, css, alpha));
  return p;
}

function drawRect(
  api: SkiaApi,
  canvas: SkCanvas,
  l: StudioTitleRectLayer,
  W: number,
  H: number,
  k: number,
  own: Owned[],
) {
  const paint = fillPaint(api, l.color, l.opacity ?? 1, own);
  const w = l.w * W;
  const h = l.h * H;
  const r = Math.max(0, Math.min((l.radiusPx ?? 0) * k, w / 2, h / 2));
  canvas.drawRRect(api.RRectXY(api.XYWHRect(l.x * W, l.y * H, w, h), r, r), paint);
}

function drawLine(
  api: SkiaApi,
  canvas: SkCanvas,
  l: StudioTitleLineLayer,
  W: number,
  H: number,
  k: number,
  own: Owned[],
) {
  const paint = fillPaint(api, l.color, 1, own);
  paint.setStyle(STYLE_STROKE);
  paint.setStrokeWidth(l.thicknessPx * k);
  paint.setStrokeCap(CAP_BUTT);
  canvas.drawLine(l.x1 * W, l.y1 * H, l.x2 * W, l.y2 * H, paint);
}

/** One line as a paragraph, in `paint` (fill or stroke), optionally with the web's shadow. */
function lineParagraph(
  deps: TitleRasterDeps,
  text: string,
  family: string,
  weight: number,
  px: number,
  letterSpacing: number,
  paint: SkPaint,
  shadow: { color: string; x: number; y: number; blur: number } | null,
  own: Owned[],
): SkParagraph {
  const { api } = deps;
  const builder = api.ParagraphBuilder.Make(
    { textAlign: TEXT_ALIGN_LEFT, maxLines: 1 },
    deps.fonts,
  );
  builder.pushStyle(
    {
      fontFamilies: [family, FALLBACK],
      fontSize: px,
      fontStyle: { weight },
      letterSpacing,
      shadows: shadow
        ? [
            {
              color: api.Color(shadow.color),
              offset: { x: shadow.x, y: shadow.y },
              blurRadius: shadow.blur,
            },
          ]
        : undefined,
    },
    paint,
  );
  builder.addText(text);
  const p = builder.build();
  own.push(p);
  try {
    builder.dispose();
  } catch {
    // the paragraph holds what it needs
  }
  p.layout(NO_WRAP);
  deps.onParagraph?.(p);
  return p;
}

/** Paragraph width of a line (the web's `ctx.measureText(line).width`). */
function measureLine(p: SkParagraph): number {
  return p.getMaxIntrinsicWidth();
}

function drawText(
  deps: TitleRasterDeps,
  canvas: SkCanvas,
  l: StudioTitleTextLayer,
  W: number,
  H: number,
  k: number,
  own: Owned[],
) {
  const { api } = deps;
  const family = sanitizeTitleFontFamily(l.fontFamily);
  const weight = effectiveTitleFontWeight(family, l.fontWeight);
  const px = l.fontSizePx * k;
  const spacing = (l.letterSpacingPx ?? 0) * k;
  const fill = fillPaint(api, l.fillColor, 1, own);
  // Fill paragraphs per line, also the measure the shared layout takes.
  const fills = new Map<string, SkParagraph>();
  const fillOf = (line: string) => {
    let p = fills.get(line);
    if (!p) {
      p = lineParagraph(deps, line, family, weight, px, spacing, fill, null, own);
      fills.set(line, p);
    }
    return p;
  };
  const layout = layoutTitleText(l, W, H, k, (line: string) => measureLine(fillOf(line)));
  const below = middleBaselineOffset(family, weight, px);

  if (l.background) {
    const bg = l.background;
    const plate = fillPaint(api, bg.color, bg.opacity, own);
    for (const line of layout.lines) {
      if (!line.text) continue;
      const { left, right } = lineExtent(l.align, line.anchorXPx, line.widthPx);
      const padX = bg.paddingXPx * k;
      const padY = bg.paddingYPx * k;
      const boxH = layout.fontPx + 2 * padY;
      const w = right - left + 2 * padX;
      const r = Math.max(0, Math.min(bg.radiusPx * k, w / 2, boxH / 2));
      canvas.drawRRect(
        api.RRectXY(api.XYWHRect(left - padX, line.centerYPx - boxH / 2, w, boxH), r, r),
        plate,
      );
    }
  }

  const strokeW = l.strokeColor ? (l.strokeWidthPx ?? 0) * k : 0;
  let stroke: SkPaint | null = null;
  if (strokeW > 0 && l.strokeColor) {
    stroke = fillPaint(api, l.strokeColor, 1, own);
    stroke.setStyle(STYLE_STROKE);
    stroke.setStrokeWidth(strokeW * 2);
    stroke.setStrokeJoin(JOIN_ROUND);
  }
  for (const line of layout.lines) {
    if (!line.text) continue;
    const fp = fillOf(line.text);
    const { left } = lineExtent(l.align, line.anchorXPx, line.widthPx);
    const baselineY = line.centerYPx + below;
    const at = (p: SkParagraph) => {
      const top = baselineY - (p.getLineMetrics()[0]?.baseline ?? 0);
      p.paint(canvas, left, top);
    };
    // Pass 1: fill with the shadow (the shadow underneath everything; the web's drawtext order).
    if (l.shadow) {
      at(
        lineParagraph(
          deps,
          line.text,
          family,
          weight,
          px,
          spacing,
          fill,
          {
            color: l.shadow.color,
            x: l.shadow.xPx * k,
            y: l.shadow.yPx * k,
            blur: (l.shadow.blurPx * k) / 2,
          },
          own,
        ),
      );
    }
    // Pass 2: the outer stroke (double width, half hidden under the fill).
    if (stroke) at(lineParagraph(deps, line.text, family, weight, px, spacing, stroke, null, own));
    // Pass 3: the glyph fill on top.
    at(fp);
  }
}

/**
 * Rasters `title` at rasterW x rasterH (the project frame at the compositor's backing size; the web's
 * `rasterTitle`). `projectW` sets the px scale (raster px per project px). Returns the snapshot
 * image (the caller owns it), or null when no surface could be made.
 */
export function rasterTitleImage(
  deps: TitleRasterDeps,
  title: StudioTitle,
  rasterW: number,
  rasterH: number,
  projectW: number,
): SkImage | null {
  const surface = deps.surface(rasterW, rasterH);
  if (!surface) return null;
  const own: Owned[] = [];
  try {
    const canvas = surface.getCanvas();
    canvas.clear(deps.api.Color('transparent'));
    const k = projectW > 0 ? rasterW / projectW : 1;
    for (const layer of title.layers) {
      if (layer.type === 'rect') drawRect(deps.api, canvas, layer, rasterW, rasterH, k, own);
      else if (layer.type === 'line') drawLine(deps.api, canvas, layer, rasterW, rasterH, k, own);
      else if (layer.type === 'text') drawText(deps, canvas, layer, rasterW, rasterH, k, own);
    }
    surface.flush();
    return surface.makeImageSnapshot();
  } finally {
    disposeAll(own);
  }
}

/** One reusable surface per size (title and caption rasters), disposed by its owner. */
export class RasterSurface {
  private readonly make: (w: number, h: number) => SkSurface | null;
  private s: SkSurface | null = null;
  private w = 0;
  private h = 0;

  constructor(make: (w: number, h: number) => SkSurface | null) {
    this.make = make;
  }

  get(w: number, h: number): SkSurface | null {
    if (this.s && this.w === w && this.h === h) return this.s;
    this.dispose();
    this.s = this.make(w, h);
    this.w = w;
    this.h = h;
    return this.s;
  }

  dispose(): void {
    try {
      this.s?.dispose();
    } catch {
      // already disposed
    }
    this.s = null;
  }
}
