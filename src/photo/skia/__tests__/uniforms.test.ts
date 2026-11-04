import { buildCurveLuts } from '../../colorMath';
import { LAYER_PARAMS, type AdjustmentLayer, type LayerType } from '../../photoTypes';
import { SKSL_LAYER_TYPES, childNames, layerSksl } from '../shaders/adjust';
import {
  CURVE_TEX_HEIGHT,
  CURVE_TEX_WIDTH,
  curveEntry,
  curveTexture,
  lutAtlas,
  packSkslLayer,
  planSkslLayers,
  uniformFloatCount,
} from '../uniforms';

const layer = (
  type: LayerType,
  params: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) =>
  ({
    id: type,
    enabled: true,
    opacity: 1,
    blend: 'normal',
    mask: null,
    type,
    params: (LAYER_PARAMS[type] as unknown as { parse(v: unknown): unknown }).parse(params),
    ...extra,
  }) as AdjustmentLayer;

const slot = (u: number[], i: number) => u.slice(i * 4, i * 4 + 4);

describe('SkSL uniform packing (same uP[] layout as the web gl/uniforms)', () => {
  it('hsl: master in slot 0, the six default ranges in slots 1..12, count in uN', () => {
    const p = packSkslLayer(layer('hsl', { master: { hue: 7, saturation: -8, lightness: 9 } }))!;
    expect(p.type).toBe('hsl');
    expect(slot(p.uniforms, 0).slice(0, 3)).toEqual([7, -8, 9]);
    const centers = [0, 60, 120, 180, 240, 300];
    centers.forEach((c, i) => expect(slot(p.uniforms, 1 + 2 * i)).toEqual([c, 30, 30, 0]));
    expect(p.uniforms[160]).toBe(6); // uN
  });

  it('hsl: six defaults plus a custom eyedropper range is seven, packed after them', () => {
    const base = LAYER_PARAMS.hsl.parse({}) as { ranges: unknown[] };
    const p = packSkslLayer(
      layer('hsl', {
        ranges: [
          ...base.ranges,
          {
            id: 'custom-1',
            center: 210,
            width: 20,
            feather: 20,
            hue: -12,
            saturation: 5,
            lightness: -8,
          },
        ],
      }),
    )!;
    expect(p.uniforms[160]).toBe(7);
    expect(slot(p.uniforms, 13)).toEqual([210, 20, 20, -12]);
    expect(slot(p.uniforms, 14).slice(0, 2)).toEqual([5, -8]);
  });

  it('hsl "grey except reds": saturation -100 on the five other ranges', () => {
    const ranges = (LAYER_PARAMS.hsl.parse({}) as { ranges: { id: string }[] }).ranges.map((r) => ({
      ...r,
      saturation: r.id === 'reds' ? 0 : -100,
    }));
    const p = packSkslLayer(layer('hsl', { ranges }))!;
    expect([0, 1, 2, 3, 4, 5].map((i) => slot(p.uniforms, 2 + 2 * i)[0])).toEqual([
      0, -100, -100, -100, -100, -100,
    ]);
  });

  it('levels: (inBlack, inWhite, gamma | outBlack, outWhite) per channel, master first', () => {
    const p = packSkslLayer(
      layer('levels', { r: { inBlack: 0.1, gamma: 2 }, master: { outWhite: 0.9 } }),
    )!;
    expect(slot(p.uniforms, 0).slice(0, 3)).toEqual([0, 1, 1]);
    expect(slot(p.uniforms, 1)[1]).toBeCloseTo(0.9, 6);
    expect(slot(p.uniforms, 2)[0]).toBeCloseTo(0.1, 6);
    expect(slot(p.uniforms, 2)[2]).toBe(2);
  });

  it('opacity, blend and the always-off mask flag follow uP', () => {
    const p = packSkslLayer(layer('invert', {}, { blend: 'color', opacity: 0.25 }))!;
    expect(p.uniforms.slice(160)).toEqual([0, 0.25, 2, 0]);
    expect(p.uniforms).toHaveLength(uniformFloatCount('invert'));
  });

  it('plans only enabled, visible rung-1 layers (rung 4 is MA51)', () => {
    const plan = planSkslLayers([
      layer('invert'),
      layer('exposure', {}, { enabled: false }),
      layer('gamma', {}, { opacity: 0 }),
      layer('sharpen'),
      layer('tone'),
    ]);
    expect(plan.map((l) => l.type)).toEqual(['invert', 'tone']);
    expect(packSkslLayer(layer('sharpen'))).toBeNull();
  });

  it('declares children in the order chainShaders passes them', () => {
    for (const t of SKSL_LAYER_TYPES) {
      const src = layerSksl(t);
      const declared = [...src.matchAll(/uniform shader (\w+);/g)].map((m) => m[1]);
      expect([t, declared]).toEqual([t, childNames(t)]);
    }
  });
});

describe('curves LUT texture', () => {
  const curves = layer('curves', {
    master: {
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 1 },
      ],
    },
    r: {
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.7 },
        { x: 1, y: 1 },
      ],
    },
  }) as Extract<AdjustmentLayer, { type: 'curves' }>;

  it('is 256 x 4 opaque RGBA8, one row per curve (r, g, b, master)', () => {
    const t = curveTexture(curves.params);
    expect([t.width, t.height]).toEqual([CURVE_TEX_WIDTH, CURVE_TEX_HEIGHT]);
    expect(t.bytes).toHaveLength(256 * 4 * 4);
    for (let i = 3; i < t.bytes.length; i += 4) expect(t.bytes[i]).toBe(255);
  });

  it('round-trips every colorMath LUT entry to 16 bits', () => {
    const t = curveTexture(curves.params);
    const luts = buildCurveLuts(curves.params);
    (['r', 'g', 'b', 'master'] as const).forEach((k, ch) => {
      for (let i = 0; i < 256; i += 1)
        expect(Math.abs(curveEntry(t, ch, i) - luts[k][i]!)).toBeLessThanOrEqual(
          0.5 / 65535 + 1e-9,
        );
    });
  });

  it('pins the bytes: master starts at 0.5 (0x8000), identity green at 128 is 128/255', () => {
    const t = curveTexture(curves.params);
    const at = (ch: number, i: number) =>
      Array.from(t.bytes.slice((ch * 256 + i) * 4, (ch * 256 + i) * 4 + 4));
    expect(at(3, 0)).toEqual([0x80, 0x00, 0, 255]);
    expect(at(3, 255)).toEqual([0xff, 0xff, 0, 255]);
    const g128 = Math.round((128 / 255) * 65535);
    expect(at(1, 128)).toEqual([g128 >> 8, g128 & 0xff, 0, 255]);
    expect(at(0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('LUT atlas', () => {
  const cube = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';

  it('lays N slices of N x N out on a grid (slice = blue index, red fastest)', () => {
    const a = lutAtlas(cube)!;
    expect([a.size, a.cols, a.width, a.height]).toEqual([2, 2, 4, 2]);
    const px = (x: number, y: number) =>
      Array.from(a.bytes.slice((y * a.width + x) * 4, (y * a.width + x) * 4 + 3));
    expect(px(1, 0)).toEqual([255, 0, 0]); // slice 0, r=1
    expect(px(0, 1)).toEqual([0, 255, 0]); // slice 0, g=1
    expect(px(2, 0)).toEqual([0, 0, 255]); // slice 1 (b=1), r=0
    expect(px(3, 1)).toEqual([255, 255, 255]);
  });

  it('no usable cube: no atlas, size 0 (the shader returns the input)', () => {
    expect(lutAtlas('')).toBeNull();
    const p = packSkslLayer(layer('lut'))!;
    expect(p.lut).toBeUndefined();
    expect(p.uniforms.slice(-2)).toEqual([0, 1]);
    expect(p.uniforms).toHaveLength(uniformFloatCount('lut'));
  });
});
