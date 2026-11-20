// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/titleRaster.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type {
  StudioTitle,
  StudioTitleLayer,
  StudioTitleTextLayer,
  StudioTitleRectLayer,
  StudioTitleLineLayer,
} from './studioTypes';
import { effectiveTitleFontWeight, sanitizeTitleFontFamily } from './titleFonts';

/**
 * Title-clip raster engine (part 16). Draws a title's layer stack onto a 2D
 * canvas at the compositor's backing resolution; the result is uploaded as a
 * GL texture and then flows through the SAME per-clip pipeline as video
 * (transform/opacity/keyframes/transitions — the point of part 15 landing
 * first).
 *
 * SHARED TITLE LAYOUT SPEC (mirrored expression-for-expression by the drawtext
 * emitter in internal/services/studio_export.go — change both or neither):
 *   - Text splits into lines on '\n'; there is NO auto-wrap.
 *   - The anchor is (x·W, y·H) in project pixels. lineHeightPx =
 *     lineHeight (default 1.2) × fontSizePx; blockH = lines × lineHeightPx;
 *     line i's center sits at anchorY − blockH/2 + (i + 0.5)·lineHeightPx.
 *   - `align` hangs each line off the anchor X: left → line starts at the
 *     anchor, center → line centers on it, right → line ends at it (canvas
 *     textAlign natively; drawtext via x/text_w expressions).
 *   - Paint order per text layer: background plate(s) → shadow+fill →
 *     stroke → fill (so the stroke reads as an OUTER border of strokeWidthPx,
 *     matching drawtext borderw; canvas lineWidth = 2×strokeWidthPx).
 *   - Background is a per-line plate (drawtext box=1 is per drawtext call and
 *     the export emits one drawtext per line): line width + 2·paddingX wide,
 *     fontSize + 2·paddingY tall, centered on the line's center.
 *
 * KNOWN EXPORT DIVERGENCES (bounded — see the title_* parity tolerance rows):
 * letter-spacing, background corner radius, shadow blur, and diagonal line
 * smoothing render in preview but degrade in the drawtext/drawbox export.
 */

/** Fallback stack appended after the curated family (raster + font picker). */
const FONT_FALLBACK = 'sans-serif';

export interface TitleTextLine {
  text: string;
  /** Vertical center of the line, raster px. */
  centerYPx: number;
  /** The anchor X the line hangs from (see spec), raster px. */
  anchorXPx: number;
  /** Measured line width, raster px (0 for empty lines). */
  widthPx: number;
}

export interface TitleTextLayout {
  lines: TitleTextLine[];
  fontPx: number;
  lineHeightPx: number;
  blockHeightPx: number;
  fontWeight: 400 | 700;
  fontFamily: string;
}

/** CSS font string for a text layer at raster scale `k`. */
export function titleFontString(layer: StudioTitleTextLayer, k: number): string {
  const family = sanitizeTitleFontFamily(layer.fontFamily);
  const weight = effectiveTitleFontWeight(family, layer.fontWeight);
  return `${weight} ${layer.fontSizePx * k}px "${family}", ${FONT_FALLBACK}`;
}

/**
 * Pure line-layout math for one text layer. `measure` returns a line's width
 * in raster px under the layer's font (injected so tests need no canvas).
 */
export function layoutTitleText(
  layer: StudioTitleTextLayer,
  rasterW: number,
  rasterH: number,
  k: number,
  measure: (line: string) => number,
): TitleTextLayout {
  const family = sanitizeTitleFontFamily(layer.fontFamily);
  const fontWeight = effectiveTitleFontWeight(family, layer.fontWeight);
  const fontPx = layer.fontSizePx * k;
  const lineHeightPx = (layer.lineHeight ?? 1.2) * fontPx;
  const rawLines = layer.text.split('\n');
  const blockHeightPx = rawLines.length * lineHeightPx;
  const anchorX = layer.x * rasterW;
  const anchorY = layer.y * rasterH;
  const lines: TitleTextLine[] = rawLines.map((text, i) => ({
    text,
    centerYPx: anchorY - blockHeightPx / 2 + (i + 0.5) * lineHeightPx,
    anchorXPx: anchorX,
    widthPx: text ? measure(text) : 0,
  }));
  return { lines, fontPx, lineHeightPx, blockHeightPx, fontWeight, fontFamily: family };
}

/**
 * The horizontal extent [left, right] a line covers given the align rule —
 * used for background plates (and unit-testable box math).
 */
export function lineExtent(
  align: StudioTitleTextLayer['align'],
  anchorXPx: number,
  widthPx: number,
): { left: number; right: number } {
  switch (align) {
    case 'left':
      return { left: anchorXPx, right: anchorXPx + widthPx };
    case 'right':
      return { left: anchorXPx - widthPx, right: anchorXPx };
    default:
      return { left: anchorXPx - widthPx / 2, right: anchorXPx + widthPx / 2 };
  }
}

/** Stable re-raster key: the title content + the raster geometry. */
export function titleRasterKey(title: StudioTitle, rasterW: number, rasterH: number): string {
  return `${rasterW}x${rasterH}:${JSON.stringify(title.layers)}`;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rad <= 0 || typeof ctx.roundRect !== 'function') {
    ctx.rect(x, y, w, h);
  } else {
    ctx.roundRect(x, y, w, h, rad);
  }
}

function drawRectLayer(ctx: CanvasRenderingContext2D, l: StudioTitleRectLayer, W: number, H: number, k: number): void {
  ctx.save();
  ctx.globalAlpha = l.opacity ?? 1;
  ctx.fillStyle = l.color;
  roundedRectPath(ctx, l.x * W, l.y * H, l.w * W, l.h * H, (l.radiusPx ?? 0) * k);
  ctx.fill();
  ctx.restore();
}

function drawLineLayer(ctx: CanvasRenderingContext2D, l: StudioTitleLineLayer, W: number, H: number, k: number): void {
  ctx.save();
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.thicknessPx * k;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(l.x1 * W, l.y1 * H);
  ctx.lineTo(l.x2 * W, l.y2 * H);
  ctx.stroke();
  ctx.restore();
}

function drawTextLayer(ctx: CanvasRenderingContext2D, l: StudioTitleTextLayer, W: number, H: number, k: number): void {
  ctx.save();
  ctx.font = titleFontString(l, k);
  // letterSpacing is preview-only richness (drawtext has no equivalent —
  // documented tolerance); guard for browsers without the property.
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${(l.letterSpacingPx ?? 0) * k}px`;
  }
  ctx.textAlign = l.align;
  ctx.textBaseline = 'middle';

  const layout = layoutTitleText(l, W, H, k, (line) => ctx.measureText(line).width);

  // Background plates (one per non-empty line, mirroring per-line drawtext box).
  if (l.background) {
    const bg = l.background;
    ctx.save();
    ctx.globalAlpha = bg.opacity;
    ctx.fillStyle = bg.color;
    for (const line of layout.lines) {
      if (!line.text) continue;
      const { left, right } = lineExtent(l.align, line.anchorXPx, line.widthPx);
      const padX = bg.paddingXPx * k;
      const padY = bg.paddingYPx * k;
      const boxH = layout.fontPx + 2 * padY;
      roundedRectPath(ctx, left - padX, line.centerYPx - boxH / 2, right - left + 2 * padX, boxH, bg.radiusPx * k);
      ctx.fill();
    }
    ctx.restore();
  }

  const strokeW = l.strokeColor ? (l.strokeWidthPx ?? 0) * k : 0;

  for (const line of layout.lines) {
    if (!line.text) continue;
    // Pass 1: fill WITH shadow — paints the shadow underneath everything
    // (drawtext order: shadow, then border, then glyph).
    if (l.shadow) {
      ctx.save();
      ctx.shadowColor = l.shadow.color;
      ctx.shadowOffsetX = l.shadow.xPx * k;
      ctx.shadowOffsetY = l.shadow.yPx * k;
      ctx.shadowBlur = l.shadow.blurPx * k;
      ctx.fillStyle = l.fillColor;
      ctx.fillText(line.text, line.anchorXPx, line.centerYPx);
      ctx.restore();
    }
    // Pass 2: outer stroke (double width, half hidden under the fill).
    if (strokeW > 0 && l.strokeColor) {
      ctx.strokeStyle = l.strokeColor;
      ctx.lineWidth = strokeW * 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(line.text, line.anchorXPx, line.centerYPx);
    }
    // Pass 3: the glyph fill on top.
    ctx.fillStyle = l.fillColor;
    ctx.fillText(line.text, line.anchorXPx, line.centerYPx);
  }
  ctx.restore();
}

/**
 * Draws the full layer stack (array order = bottom → top) onto a cleared
 * canvas of rasterW×rasterH representing the project frame. `projectW` sets
 * the px scale factor (raster px per project px).
 */
export function rasterTitle(
  ctx: CanvasRenderingContext2D,
  title: StudioTitle,
  rasterW: number,
  rasterH: number,
  projectW: number,
): void {
  const k = projectW > 0 ? rasterW / projectW : 1;
  ctx.clearRect(0, 0, rasterW, rasterH);
  for (const layer of title.layers as StudioTitleLayer[]) {
    switch (layer.type) {
      case 'rect':
        drawRectLayer(ctx, layer, rasterW, rasterH, k);
        break;
      case 'line':
        drawLineLayer(ctx, layer, rasterW, rasterH, k);
        break;
      case 'text':
        drawTextLayer(ctx, layer, rasterW, rasterH, k);
        break;
      default:
        break;
    }
  }
}
