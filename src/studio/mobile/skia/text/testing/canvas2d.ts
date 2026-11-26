/**
 * Test helper (MA62 S3): a Canvas 2D context for the web's own `rasterTitle` (the copied
 * `src/studio/titleRaster.ts`, run unchanged), built on CanvasKit's Canvas2D emulation
 * (`CanvasKit.MakeCanvas`, the same Skia, drawing glyphs as unshaped text blobs).
 *
 * The emulation lacks three things the web's code relies on, added here by the canvas spec and
 * nothing else:
 * - `textAlign` (left / center / right): the x anchor minus 0 / half / all of `measureText(line)`;
 * - `textBaseline = 'middle'`: the alphabetic baseline below the given y by Blink's em-box rule,
 *   `middleBaselineOffset` (shared with the phone port: the one rule both sides state; whether
 *   Blink really uses the OS/2 typo metrics for every family is a device/browser check, not
 *   something jest can see);
 * - a font string with quotes and a fallback list (`700 37px "Inter", sans-serif`): reduced to
 *   `700 37px Inter` (the emulation's parser takes one bare family).
 * - a shadow with `shadowBlur = 0` (the emulation throws on it): per the canvas spec it is the same
 *   glyphs in `shadowColor`, offset by `shadowOffsetX/Y`, drawn first.
 * `roundRect` and `letterSpacing` stay absent, as in a browser without them (the web's code guards
 * both); the parity scenarios set no radius and no letter spacing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { middleBaselineOffset } from '../titleRaster';

const FONT_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'assets', 'fonts', 'studio');

interface Manifest {
  files: { file: string; family: string; weight: number }[];
}
export const FONT_MANIFEST = JSON.parse(
  readFileSync(join(FONT_DIR, 'manifest.json'), 'utf8'),
) as Manifest;
export const fontBytes = (file: string) => readFileSync(join(FONT_DIR, file));

type CK = {
  MakeCanvas(
    w: number,
    h: number,
  ): {
    getContext(kind: '2d'): Record<string, unknown> & {
      measureText(s: string): { width: number };
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    };
    loadFont(
      bytes: ArrayBuffer | Uint8Array,
      desc: { family: string; style: string; weight: string },
    ): void;
    dispose(): void;
  };
};

/**
 * Draws `draw(ctx)` on a W x H CanvasKit Canvas2D with the studio fonts; returns straight RGBA.
 * `measure` (optional) replaces `ctx.measureText(line).width`: the parity suite passes the phone's
 * paragraph widths so both sides lay lines out from the same numbers (see the suite's header).
 */
export function rasterWithCanvas2d(
  ck: unknown,
  W: number,
  H: number,
  draw: (ctx: unknown) => void,
  measure?: (text: string, font: { family: string; weight: number; px: number }) => number,
): Uint8Array {
  const kit = ck as CK;
  const canvas = kit.MakeCanvas(W, H);
  for (const f of FONT_MANIFEST.files) {
    const b = fontBytes(f.file);
    canvas.loadFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), {
      family: f.family,
      style: 'normal',
      weight: String(f.weight),
    });
  }
  const ctx = canvas.getContext('2d');
  const state = {
    align: 'start',
    baseline: 'alphabetic',
    family: 'Inter',
    weight: 400,
    px: 10,
    shadow: { color: 'rgba(0,0,0,0)', x: 0, y: 0, blur: 0 },
    stack: [] as unknown[],
  };
  const fillText = (ctx.fillText as (t: string, x: number, y: number) => void).bind(ctx);
  const strokeText = (ctx.strokeText as (t: string, x: number, y: number) => void).bind(ctx);
  const save = (ctx.save as () => void).bind(ctx);
  const restore = (ctx.restore as () => void).bind(ctx);
  const widthOf = (text: string) => (measure ? measure(text, state) : ctx.measureText(text).width);
  const place = (text: string, x: number, y: number): [number, number] => {
    const w = widthOf(text);
    const dx =
      state.align === 'center' ? w / 2 : state.align === 'right' || state.align === 'end' ? w : 0;
    const dy =
      state.baseline === 'middle' ? middleBaselineOffset(state.family, state.weight, state.px) : 0;
    return [x - dx, y + dy];
  };
  const shim = new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'textAlign') return state.align;
      if (prop === 'textBaseline') return state.baseline;
      if (prop === 'measureText') return (t: string) => ({ width: widthOf(t) });
      if (prop === 'fillText')
        return (t: string, x: number, y: number) => {
          const [px, py] = place(t, x, y);
          const sh = state.shadow;
          if (sh.blur === 0 && (sh.x !== 0 || sh.y !== 0) && sh.color !== 'rgba(0,0,0,0)') {
            const fill = (target as Record<string, unknown>).fillStyle;
            (target as Record<string, unknown>).fillStyle = sh.color;
            fillText(t, px + sh.x, py + sh.y);
            (target as Record<string, unknown>).fillStyle = fill;
          }
          fillText(t, px, py);
        };
      if (prop === 'strokeText')
        return (t: string, x: number, y: number) => strokeText(t, ...place(t, x, y));
      if (prop === 'save')
        return () => {
          state.stack.push({
            align: state.align,
            baseline: state.baseline,
            family: state.family,
            weight: state.weight,
            px: state.px,
            shadow: { ...state.shadow },
          });
          save();
        };
      if (prop === 'restore')
        return () => {
          Object.assign(state, state.stack.pop() ?? {});
          restore();
        };
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set(target, prop, value) {
      if (prop === 'textAlign') state.align = value as string;
      else if (prop === 'textBaseline') state.baseline = value as string;
      // Shadows are drawn by the shim (above), never by the emulation.
      else if (prop === 'shadowColor') state.shadow.color = String(value);
      else if (prop === 'shadowOffsetX') state.shadow.x = Number(value);
      else if (prop === 'shadowOffsetY') state.shadow.y = Number(value);
      else if (prop === 'shadowBlur') state.shadow.blur = Number(value);
      else if (prop === 'font') {
        const m = /^(\d+)\s+([\d.]+)px\s+"([^"]+)"/.exec(String(value));
        if (m) {
          state.weight = Number(m[1]);
          state.px = Number(m[2]);
          state.family = m[3]!;
          (target as Record<string, unknown>).font = `${m[1]} ${m[2]}px ${m[3]}`;
        } else (target as Record<string, unknown>).font = value;
      } else (target as Record<string, unknown>)[prop as string] = value;
      return true;
    },
    has(target, prop) {
      return prop === 'textAlign' || prop === 'textBaseline' || Reflect.has(target, prop);
    },
  });
  draw(shim);
  const data = new Uint8Array(ctx.getImageData(0, 0, W, H).data);
  canvas.dispose();
  return data;
}
