/**
 * @jest-environment node
 *
 * Darkroom compositor parity (ticket MA62 S2, decision 10): the SkSL stages on real Skia
 * (CanvasKit) against the web's own code.
 *
 * What the web provides, and what each check uses (no expected value is invented here):
 * - **the web compositor itself** (`src/studio/compositor/glCompositor.ts`, copied from UI `main`):
 *   run on a recording WebGL2 context, it yields the exact quad and uniforms the web draws for each
 *   golden layer. The phone's pure packers must reproduce those numbers;
 * - **the web's CPU reference** for the colour math (`studioColorMath.ts` = UI
 *   `lib/studio/colorMath.ts`, "the NORMATIVE statement of the math both renderers implement") and
 *   the trilinear LUT lookup (`colorMath.ts` `sampleLut3D` = UI `lib/photo/colorMath.ts`): the
 *   SkSL renders the web's photo fixture images through each stage and is compared per pixel;
 * - **the parity scenarios** (`src/studio/parity/goldens/*.json`, the harness's golden EDLs): their
 *   layers are built with the web's own `buildLayersAtTime` at the golden sample frames.
 *
 * The web commits NO golden frames: the harness renders them on a GPU workstation from ffmpeg
 * fixtures that are not in git (`parity-harness/README.md`). So the rows' thresholds
 * (`parityTolerances.ts`, preview vs EXPORT) are applied here to phone vs the web's CPU reference
 * (the math both previews implement) on the fixture images, with the web's own metric code
 * (`parity/imageMetrics.ts`, uncalibrated: the assumed 40 dB / 1.0 floor). Stages the web has no
 * CPU reference for are checked against the web's GL geometry or marked visual only in
 * `TOLERANCE_TABLE` below. A tolerance is never loosened here: a miss fails the test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildLayersAtTime, orderedVideoClips } from '../../../../compositor/buildLayers';
import { meanDeltaE, psnr } from '../../../../parity/imageMetrics';
import { parityTolerance } from '../../../../parityTolerances';
import { parseCubeLut, type ParsedLut } from '../../../../../photo/studioLutParser';
import { blendChannel } from '../../../../../photo/studioColorMath';
import { Compositor, type FrameLayer, type SkiaApi } from '../compositor';
import { BLEND_INDEX } from '../shaders/blend';
import { STAGE_IDS, STAGES } from '../shaders/stages';
import { layerQuad, lutAtlas, planLayer, type CompLayer } from '../uniforms';
import { loadSkiaApi } from '../../../../../photo/skia/testing/skiaTestApi';
import { referenceComposite, referenceGeometry, type Rgba } from '../testing/reference';
import { diff8, fixtureImage, makeImage, renderFrame } from '../testing/render';
import { lutPresence, webDraws } from '../testing/webReference';

jest.setTimeout(180_000);

const PARITY = join(__dirname, '..', '..', '..', '..', 'parity');
const goldens = Object.fromEntries(
  readdirSync(join(PARITY, 'goldens'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(PARITY, 'goldens', f), 'utf8'))]),
) as Record<string, any>;
const FIXTURE_LUT: ParsedLut = parseCubeLut(readFileSync(join(PARITY, 'fixture.cube'), 'utf8'));

/** The golden's layers at each sample frame, built by the web's own builder (16x9 sources like the fake upload). */
function goldenLayers(id: string, W: number, H: number): CompLayer[][] {
  const g = goldens[id]!;
  const fps = g.project.fps || 30;
  const lutKeys = Object.entries(g.assets as Record<string, { kind: string }>)
    .filter(([, a]) => a.kind === 'lut')
    .map(([k]) => k);
  return g.sampleFrames.map((frame: number) => {
    const t = frame / fps;
    const active = orderedVideoClips(g.project.tracks, t);
    const sources = new Map(active.map((a: any, i: number) => [a.clip.id, { slot: i, srcW: W, srcH: H }]));
    return buildLayersAtTime(active, g.project.tracks, t, sources, lutPresence(lutKeys) as never, W, H) as CompLayer[];
  });
}

/** Thresholds come from the web's table, never from here. */
function meets(id: string, phone: Rgba, ref: Rgba): { value: number; threshold: number; pass: boolean; metric: string } {
  const row = parityTolerance(id);
  if (!row) throw new Error(`no tolerance row ${id}`);
  if (row.metric === 'psnr') {
    const v = psnr(phone, ref);
    return { value: v, threshold: row.threshold, pass: v >= row.threshold, metric: 'psnr' };
  }
  const v = meanDeltaE(phone, ref);
  return { value: v, threshold: row.threshold, pass: v <= row.threshold, metric: 'deltaE' };
}

let api: SkiaApi;
beforeAll(async () => {
  api = await loadSkiaApi();
});

describe('every stage compiles with the uniform layout the packer fills', () => {
  it.each(STAGE_IDS)('%s', (id) => {
    const e = new Compositor(api).effect(id);
    expect([id, e.getUniformFloatCount()]).toEqual([id, STAGES[id].uniformFloats]);
  });
});

describe('packing equals what the web GLCompositor sends (recorded, all golden layers)', () => {
  const W = 640;
  const H = 360;
  const visualIds = Object.keys(goldens).filter((id) => !id.startsWith('audio_') && !id.startsWith('title_'));

  it.each(visualIds)('%s: quad, UVs and every uniform', (id) => {
    for (const layers of goldenLayers(id, W, H)) {
      const draws = webDraws(layers, W, H, { 'fx-lut': FIXTURE_LUT });
      expect(draws).toHaveLength(layers.length);
      layers.forEach((layer, i) => {
        const d = draws[i]!;
        // Geometry: the web's clip-space corners (TL, BL, TR, BR) = layerQuad in pixels.
        const q = layerQuad(layer.solid ? { ...layer, srcW: W, srcH: H } : layer, W, H);
        const clip = (p: [number, number]) => [(p[0] / W) * 2 - 1, 1 - (p[1] / H) * 2];
        const mine = [...clip(q.tl), ...clip(q.bl), ...clip(q.tr), ...clip(q.br)];
        mine.forEach((v, k) => expect(v).toBeCloseTo(d.positions[k]!, 5));
        expect(d.uvs).toEqual([q.uv[0], q.uv[1], q.uv[0], q.uv[3], q.uv[2], q.uv[1], q.uv[2], q.uv[3]].map(Math.fround));
        // Stage switches and values.
        const plan = planLayer(layer, W, H, layer.lut ? lutAtlas(FIXTURE_LUT) : null)!;
        const ids = plan.map((p) => p.id);
        const u = d.uniforms;
        expect(ids.includes('eq')).toBe(u.uHasEq![0] === 1);
        expect(ids.includes('lumetri')).toBe(u.uHasLumetri![0] === 1);
        expect(ids.includes('lut')).toBe(u.uHasLut![0] === 1);
        expect(ids.includes('chromakey')).toBe(u.uHasChroma![0] === 1);
        const stage = (s: string) => plan.find((p) => p.id === s)!.floats;
        if (u.uHasEq![0] === 1) expect(stage('eq')).toEqual(u.uEq);
        if (u.uHasLumetri![0] === 1)
          expect(stage('lumetri')).toEqual(
            ['uExposure', 'uLumContrast', 'uLumSaturation', 'uTemperature', 'uTint', 'uVibrance'].map((n) => u[n]![0]),
          );
        if (u.uHasLut![0] === 1) expect(stage('lut')[2]).toBe(u.uLutIntensity![0]);
        if (u.uHasChroma![0] === 1)
          expect(stage('chromakey')).toEqual([...u.uKeyColor!, u.uSimilarity![0], u.uChromaBlend![0], u.uDespill![0]]);
        const alpha = stage('alpha');
        expect(alpha[0]).toBe(u.uOpacity![0]);
        expect(alpha[1]).toBe(u.uHasWipe![0]);
        if (u.uHasWipe![0] === 1) expect(alpha.slice(2, 6)).toEqual(u.uWipe);
        expect(alpha.slice(6)).toEqual(u.uOutSize);
        expect(BLEND_INDEX[layer.blendMode ?? 'normal']).toBe(u.uBlendMode![0]);
        expect(layer.solid ? 1 : 0).toBe(u.uHasSolid![0]);
      });
    }
  });
});

/**
 * Colour stages on the fixture images: the golden's own effect values (from its layers), applied
 * to each opaque fixture image at its own size, phone SkSL vs the web CPU reference.
 */
const COLOUR_ROWS: [row: string, golden: string][] = [
  ['eq_adjustments', 'eq_adjustments'],
  ['lumetri_exposure', 'lumetri_exposure'],
  ['lumetri_temp_tint', 'lumetri_temp_tint'],
  ['lumetri_contrast_saturation', 'lumetri_contrast_saturation'],
  ['lumetri_vibrance', 'lumetri_vibrance'],
  ['lut_full', 'lut_full'],
  ['lut_intensity', 'lut_intensity'],
  ['keyframe_lumetri', 'keyframe_lumetri'],
  ['effect_stack_first_per_type', 'effect_stack_first_per_type'],
];

const results: string[] = [];
afterAll(() => {
  // The measured values, for the session report (one line per row x image x frame).
  if (process.env.MA62_PARITY_REPORT) console.log(results.join('\n'));
});

async function drawPixelAligned(layers: CompLayer[], imgs: Rgba[], W: number, H: number) {
  const comp = new Compositor(api);
  comp.loadLut('fx-lut', FIXTURE_LUT);
  const images = imgs.map((i) => makeImage(api, i));
  const frame: FrameLayer[] = layers.map((layer, i) => ({ key: `l${i}`, layer, source: { kind: 'image', image: images[i]! } }));
  const out = await renderFrame(api, comp, frame, W, H);
  comp.dispose();
  images.forEach((i) => i.dispose());
  return out;
}

describe('colour stages vs the web CPU reference (fixture images, tolerance rows of 03-parity-tolerances)', () => {
  it.each(COLOUR_ROWS)('%s (%s scenario values)', async (row, golden) => {
    for (const name of ['photo', 'chart'] as const) {
      const img = fixtureImage(name);
      const frames = goldenLayers(golden, img.width, img.height);
      for (let f = 0; f < frames.length; f += 1) {
        const layers = frames[f]!.map((l) => ({ ...l, transform: undefined, crop: undefined }));
        const phone = await drawPixelAligned(layers, layers.map(() => img), img.width, img.height);
        const ref = referenceComposite(layers, layers.map(() => img), img.width, img.height, { 'fx-lut': FIXTURE_LUT });
        const m = meets(row, phone, ref);
        const d = diff8(phone, ref);
        const label = `${row}.${name}.f${goldens[golden].sampleFrames[f]} ${m.metric}=${m.value.toFixed(2)} (row ${m.threshold}) max8=${d.max} mean8=${d.mean.toFixed(3)}`;
        results.push(label);
        expect([label, m.pass]).toEqual([label, true]);
      }
    }
  });
});

describe('blend modes vs blendChannel (the BLEND SPEC), both Skia BlendMode and the addition layer route', () => {
  const MODES = ['normal', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'addition', 'difference'] as const;

  it.each(MODES)('%s over photo, layer chart at 0.8 (the blend goldens) and at 1.0 and 0.35', async (mode) => {
    const back = fixtureImage('photo');
    const chart = fixtureImage('chart');
    const W = back.width;
    const H = back.height;
    // The chart's top 256x192 region, so both sources are W x H.
    const top: Rgba = { width: W, height: H, data: chart.data.slice(0, W * H * 4) };
    const rowId = mode === 'normal' ? 'opacity_dissolve' : `blend_${mode}`;
    for (const opacity of [0.8, 1, 0.35]) {
      const layers: CompLayer[] = [
        { slot: 0, srcW: W, srcH: H, opacity: 1 },
        { slot: 1, srcW: W, srcH: H, opacity, blendMode: mode },
      ];
      const phone = await drawPixelAligned(layers, [back, top], W, H);
      const ref = referenceComposite(layers, [back, top], W, H, {});
      const m = meets(rowId, phone, ref);
      const d = diff8(phone, ref);
      const label = `${mode}@${opacity} ${m.metric}=${m.value.toFixed(2)} (row ${rowId} ${m.threshold}) max8=${d.max}`;
      results.push(label);
      expect([label, m.pass]).toEqual([label, true]);
      // Beyond the row: the port is meant to be the same arithmetic, so it stays within rounding.
      expect([label, d.max <= 2]).toEqual([label, true]);
    }
  });

  it('addition really differs from Skia Plus where b + c > 1 and a < 1 (why it has its own route)', () => {
    const b = 0.8;
    const c = 0.7;
    const a = 0.3;
    const web = b + (blendChannel('addition', b, c) - b) * a;
    const plus = Math.min(b + a * c, 1);
    expect(Math.abs(web - plus)).toBeGreaterThan(0.1);
  });

  it('straight-alpha source (alpha fixture) over an opaque backdrop: alpha = srcAlpha x opacity', async () => {
    const back = fixtureImage('chart');
    const alpha = fixtureImage('alpha');
    const W = back.width;
    const H = back.height;
    for (const mode of ['normal', 'multiply', 'addition'] as const) {
      const layers: CompLayer[] = [
        { slot: 0, srcW: W, srcH: H, opacity: 1 },
        { slot: 1, srcW: W, srcH: H, opacity: 0.8, blendMode: mode },
      ];
      const phone = await drawPixelAligned(layers, [back, alpha], W, H);
      const ref = referenceComposite(layers, [back, alpha], W, H, {});
      const d = diff8(phone, ref);
      // Premultiplied storage of low-alpha source texels loses colour bits (an RGBA8 image is
      // premultiplied in Skia; the web uploads straight RGBA): bounded by 1 / alpha rounding.
      const label = `${mode} alpha-src max8=${d.max} mean8=${d.mean.toFixed(3)} psnr=${psnr(phone, ref).toFixed(2)}`;
      results.push(label);
      expect([label, psnr(phone, ref) >= parityTolerance('image_alpha_over_video')!.threshold]).toEqual([label, true]);
    }
  });
});

describe('geometry (crop, fit, transform) vs the web GLCompositor quad, rasterised by the GL rule', () => {
  const GEO: [row: string, golden: string][] = [
    ['passthrough', 'passthrough'],
    ['crop', 'crop'],
    ['transform_position_scale', 'transform_position_scale'],
    ['transform_rotation', 'transform_rotation'],
    ['keyframe_transform', 'keyframe_transform'],
  ];
  it.each(GEO)('%s', async (row, golden) => {
    // Project 640x360 scaled to 256x144 so the chart (256x256, a different aspect) is letterboxed by fit.
    const W = 256;
    const H = 144;
    const src = fixtureImage('chart');
    const g = goldens[golden];
    const fps = g.project.fps || 30;
    for (const frame of g.sampleFrames as number[]) {
      const t = frame / fps;
      const active = orderedVideoClips(g.project.tracks, t);
      const sources = new Map(active.map((a: any, i: number) => [a.clip.id, { slot: i, srcW: src.width, srcH: src.height }]));
      const layers = buildLayersAtTime(active, g.project.tracks, t, sources, lutPresence([]) as never, W, H) as CompLayer[];
      expect(layers).toHaveLength(1);
      const draw = webDraws(layers, W, H)[0]!;
      const ref = referenceGeometry(draw, src, W, H);
      const phone = await drawPixelAligned(layers, [src], W, H);
      const m = meets(row, phone, ref);
      const d = diff8(phone, ref);
      const label = `${row}.f${frame} ${m.metric}=${m.value.toFixed(2)} (row ${m.threshold}) max8=${d.max} mean8=${d.mean.toFixed(3)}`;
      results.push(label);
      expect([label, m.pass]).toEqual([label, true]);
    }
  });
});

describe('chroma key: no web CPU reference exists (visual only); invariants of the ported formula', () => {
  it('keys the key colour out, keeps far colours, despills only the keyed part', async () => {
    const W = 4;
    const H = 1;
    const px = new Uint8Array([0, 255, 0, 255, 255, 0, 0, 255, 40, 200, 40, 255, 128, 128, 128, 255]);
    const src: Rgba = { width: W, height: H, data: px };
    const black: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) };
    const layers: CompLayer[] = [
      { slot: 0, srcW: W, srcH: H, opacity: 1 },
      { slot: 1, srcW: W, srcH: H, opacity: 1, chroma: { keyColor: [0, 1, 0], similarity: 0.25, blend: 0.15, despill: 0.5 } },
    ];
    const out = await drawPixelAligned(layers, [black, src], W, H);
    expect(Array.from(out.data.slice(0, 3))).toEqual([0, 0, 0]); // pure key: gone
    expect(Array.from(out.data.slice(4, 7))).toEqual([255, 0, 0]); // red: untouched
    expect(Array.from(out.data.slice(12, 15))).toEqual([128, 128, 128]); // grey: untouched
    // Near-green: partly keyed, and its green despilled towards (r + b) / 2.
    expect(out.data[9]!).toBeLessThan(200);
  });
});

/**
 * The tolerance table (decision 10). Every compositor stage of S2 and the row it is held to.
 * `golden` = what the phone's output is compared with in this suite.
 */
export const TOLERANCE_TABLE = [
  { stage: 'crop', row: 'crop', golden: 'web GLCompositor quad + UVs, GL-rule raster of the chart fixture' },
  { stage: 'fit', row: 'passthrough', golden: 'same (letterboxed fit of a square source)' },
  { stage: 'transform (position, scale)', row: 'transform_position_scale', golden: 'same' },
  { stage: 'transform (rotation)', row: 'transform_rotation', golden: 'same' },
  { stage: 'transform (keyframed)', row: 'keyframe_transform', golden: 'same' },
  { stage: 'eq', row: 'eq_adjustments', golden: 'web CPU reference eqAdjust' },
  { stage: 'lumetri', row: 'lumetri_* + keyframe_lumetri', golden: 'web CPU reference lumetriAdjust' },
  { stage: 'lut', row: 'lut_full, lut_intensity', golden: 'web CPU reference sampleLut3D (export lattice; see lut.ts deviation)' },
  { stage: 'chromakey', row: 'chromakey', golden: 'VISUAL ONLY: the web has no CPU reference; invariants tested' },
  { stage: 'alpha (opacity, straight-alpha source)', row: 'opacity_dissolve, image_alpha_over_video', golden: 'BLEND SPEC over the CPU reference' },
  { stage: 'alpha (wipe mask)', row: 'transition_wipe', golden: 'S3: pixels vs the web GLCompositor draws (transitionParity.test.ts); the mask edge is pixel-identical' },
  { stage: 'blend (7 Skia BlendModes + addition)', row: 'blend_*', golden: 'web CPU reference blendChannel via the BLEND SPEC' },
] as const;

it('the tolerance table names a real row for every stage', () => {
  for (const r of TOLERANCE_TABLE) {
    for (const id of r.row.split(/[ ,+]+/).filter((x) => /^[a-z_]+$/.test(x) && !x.endsWith('_'))) {
      expect([id, parityTolerance(id) !== undefined]).toEqual([id, true]);
    }
  }
});
