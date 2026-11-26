/**
 * @jest-environment node
 *
 * Darkroom transition parity (ticket MA62 S3, decisions 7 and 10): all 15 typed transitions of the
 * web (part 14) through the phone compositor, against the web's own code. Nothing expected is
 * stated here: the layers come from the copied `buildLayersAtTime` (the web's mirror of
 * `buildGLLayer`, over the copied `transitionFrameState` / `clipTransitionState`), the reference is
 * what the copied web `GLCompositor` sends to the GPU for those layers (recorded on a fake WebGL2
 * context: quads, UVs, `uOpacity`, `uHasWipe` / `uWipe`, `uHasSolid` / `uSolidColor`), rasterised by
 * GL's rule (`testing/reference.ts` `referenceDraws`), and the thresholds are the rows of
 * `parityTolerances.ts` (`03-parity-tolerances.md`), never loosened here.
 *
 * Scenarios: the harness's four transition goldens (`src/studio/parity/goldens/transition_*.json`,
 * sample frames 51 / 60 / 69) as written, plus the same EDL with each other type of the row's family
 * swapped in (the goldens hold one direction per family; the other directions are the same row by
 * the table's own grouping) and crossDissolve on the dip scenario (`opacity_dissolve`, the row its
 * note names). Sources are the web's photo fixtures (`chart` for the outgoing clip, `photo` for the
 * entering one), so every edge and mask boundary crosses real detail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLayersAtTime, orderedVideoClips } from '../../../../compositor/buildLayers';
import { psnr } from '../../../../parity/imageMetrics';
import { parityTolerance } from '../../../../parityTolerances';
import { transitionFrameState } from '../../../../previewEngine';
import { studioTransitionTypeSchema, type StudioTransitionType } from '../../../../studioTypes';
import { loadSkiaApi } from '../../../../../photo/skia/testing/skiaTestApi';
import { Compositor, type FrameLayer, type SkiaApi } from '../compositor';
import { referenceDraws, type Rgba } from '../testing/reference';
import { diff8, fixtureImage, makeImage, renderFrame } from '../testing/render';
import { lutPresence, webDraws } from '../testing/webReference';
import { TRANSITION_PORTS } from '../transitions';
import type { CompLayer } from '../uniforms';

jest.setTimeout(180_000);

const GOLDENS = join(__dirname, '..', '..', '..', '..', 'parity', 'goldens');
const golden = (id: string) => JSON.parse(readFileSync(join(GOLDENS, `${id}.json`), 'utf8'));

/** The family golden each type is checked on (its own golden when the harness has one). */
const SCENARIO: Record<string, string> = {
  opacity_dissolve: 'transition_dip',
  transition_dip: 'transition_dip',
  transition_wipe: 'transition_wipe',
  transition_push: 'transition_push',
  transition_slide: 'transition_slide',
};

// Project 640x360 scaled to 192x108 (16:9, like the goldens) so jest stays quick.
const W = 192;
const H = 108;

let api: SkiaApi;
let A: Rgba;
let B: Rgba;
beforeAll(async () => {
  api = await loadSkiaApi();
  A = fixtureImage('chart');
  B = fixtureImage('photo');
});

const results: string[] = [];
afterAll(() => {
  if (process.env.MA62_PARITY_REPORT) console.log(results.join('\n'));
});

/** The golden EDL with the entering clip's transition type replaced by `type`. */
function scenario(type: StudioTransitionType) {
  const g = golden(SCENARIO[TRANSITION_PORTS[type].row]!);
  const p = structuredClone(g.project);
  const clipIn = p.tracks[0].clips.find((c: { id: string }) => c.id === 'c-in');
  clipIn.transition = { ...clipIn.transition, type };
  return { project: p, frames: g.sampleFrames as number[], fps: (g.project.fps as number) || 30 };
}

async function phoneFrame(layers: CompLayer[], srcOf: (l: CompLayer) => Rgba | null) {
  const comp = new Compositor(api);
  const images = layers.map((l) => {
    const s = srcOf(l);
    return s ? makeImage(api, s) : null;
  });
  const frame: FrameLayer[] = layers.map((layer, i) => ({
    key: `l${i}`,
    layer,
    source: layer.solid ? { kind: 'solid' } : { kind: 'image', image: images[i]! },
  }));
  const out = await renderFrame(api, comp, frame, W, H);
  comp.dispose();
  images.forEach((i) => i?.dispose());
  return out;
}

describe('every typed transition has a port and a real tolerance row', () => {
  it('covers the web enum exactly', () => {
    expect(Object.keys(TRANSITION_PORTS).sort()).toEqual(
      [...studioTransitionTypeSchema.options].sort(),
    );
    for (const p of Object.values(TRANSITION_PORTS)) expect(parityTolerance(p.row)).toBeDefined();
  });

  it('the scenarios really transition at every sample frame (0 < p < 1)', () => {
    for (const type of studioTransitionTypeSchema.options) {
      const s = scenario(type);
      const clipIn = s.project.tracks[0].clips[1];
      for (const f of s.frames) {
        const p = (f / s.fps - clipIn.timelineStart) / clipIn.transition.durationSeconds;
        expect([type, f, p > 0 && p < 1]).toEqual([type, f, true]);
      }
    }
  });
});

describe.each(studioTransitionTypeSchema.options)('%s', (type) => {
  const port = TRANSITION_PORTS[type];

  it(`pixels vs the web GLCompositor's draws, GL-rule raster (row ${port.row})`, async () => {
    const row = parityTolerance(port.row)!;
    expect(row.metric).toBe('psnr');
    const s = scenario(type);
    for (const f of s.frames) {
      const t = f / s.fps;
      const active = orderedVideoClips(s.project.tracks, t);
      const sizes = new Map(
        active.map((a, i) => [
          a.clip.id,
          {
            slot: i,
            srcW: (a.clip.id === 'c-out' ? A : B).width,
            srcH: (a.clip.id === 'c-out' ? A : B).height,
          },
        ]),
      );
      const layers = buildLayersAtTime(
        active,
        s.project.tracks,
        t,
        sizes,
        lutPresence([]) as never,
        W,
        H,
      ) as CompLayer[];
      const srcOf = (l: CompLayer) =>
        l.solid ? null : l.slot === sizes.get('c-out')!.slot ? A : B;
      const draws = webDraws(layers, W, H);
      expect(draws).toHaveLength(layers.length);
      // No colour stage takes part in a transition scenario (so the reference needs none).
      for (const d of draws) {
        for (const sw of ['uHasEq', 'uHasLumetri', 'uHasLut', 'uHasChroma'])
          expect(d.uniforms[sw]![0]).toBe(0);
        expect(d.uniforms.uBlendMode![0]).toBe(0);
      }
      const ref = referenceDraws(draws, layers.map(srcOf), W, H);
      const phone = await phoneFrame(layers, srcOf);
      const v = psnr(phone, ref);
      const d = diff8(phone, ref);
      const st = transitionFrameState(type, (t - 1.5) / 1);
      const label = `${type}.f${f} psnr=${v.toFixed(2)} (row ${port.row} ${row.threshold}) max8=${d.max} mean8=${d.mean.toFixed(3)} dip=${st.dip ? st.dip.alpha.toFixed(2) : '-'}`;
      results.push(label);
      expect([label, v >= row.threshold]).toEqual([label, true]);
    }
  });
});

describe('the wipe mask (S2 left it "visual only"): pixel-exact edge vs the web GLSL rule', () => {
  it.each(['wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown'] as const)(
    '%s: every pixel on the right side of the edge',
    async (type) => {
      // A solid white entering clip over black, so the mask alone decides each pixel.
      const white: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(255) };
      const s = scenario(type);
      for (const f of s.frames) {
        const t = f / s.fps;
        const active = orderedVideoClips(s.project.tracks, t).filter((a) => a.clip.id === 'c-in');
        const sizes = new Map(active.map((a) => [a.clip.id, { slot: 0, srcW: W, srcH: H }]));
        const layers = buildLayersAtTime(
          active,
          s.project.tracks,
          t,
          sizes,
          lutPresence([]) as never,
          W,
          H,
        ) as CompLayer[];
        expect(layers).toHaveLength(1);
        const draws = webDraws(layers, W, H);
        const ref = referenceDraws(draws, [white], W, H);
        const phone = await phoneFrame(layers, () => white);
        const d = diff8(phone, ref);
        results.push(`${type}.f${f} mask max8=${d.max}`);
        // The same comparisons on the same pixel centres: identical masks, not "within tolerance".
        expect([type, f, d.max]).toEqual([type, f, 0]);
      }
    },
  );
});
