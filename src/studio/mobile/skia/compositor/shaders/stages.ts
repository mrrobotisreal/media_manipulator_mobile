/**
 * The Darkroom compositor's SkSL stages, in the web's fragment order (ticket MA62 decision 6):
 * geometry (crop -> fit -> transform) -> eq -> lumetri -> lut -> chromakey -> alpha, then the blend
 * (Skia `BlendMode`, plus `opaque` for `addition`: `./blend.ts`). Each stage is one runtime effect;
 * this file is the registry the compositor and the tests iterate.
 *
 * Mechanical differences from the GLSL (media-manipulator-ui `lib/studio/glCompositor.ts`), as in
 * Aperture's port (`src/photo/skia/shaders/adjust.ts`):
 * - the web runs one fragment shader with `uHas*` switches; SkSL has no preprocessor and RN Skia
 *   packs every uniform as a float, so each stage is its own effect and a layer chains only the
 *   stages it uses (an absent stage = the GLSL's skipped branch);
 * - textures are child shaders evaluated in pixel coordinates and arrive PREMULTIPLIED: each colour
 *   stage un-premultiplies, applies the GLSL's straight-colour math, and re-premultiplies;
 * - the 3D LUT is a 2D atlas of N slices (no `sampler3D` in SkSL), as in Aperture.
 */
import { ALPHA_CHILDREN, ALPHA_SKSL, ALPHA_UNIFORM_FLOATS } from './alpha';
import { OPAQUE_CHILDREN, OPAQUE_SKSL, OPAQUE_UNIFORM_FLOATS } from './blend';
import { CHROMA_CHILDREN, CHROMA_SKSL, CHROMA_UNIFORM_FLOATS } from './chromakey';
import { EQ_CHILDREN, EQ_SKSL, EQ_UNIFORM_FLOATS } from './eq';
import { GEOMETRY_CHILDREN, GEOMETRY_SKSL, GEOMETRY_UNIFORM_FLOATS } from './geometry';
import { LUMETRI_CHILDREN, LUMETRI_SKSL, LUMETRI_UNIFORM_FLOATS } from './lumetri';
import { LUT_CHILDREN, LUT_SKSL, LUT_UNIFORM_FLOATS } from './lut';

export type StageId = 'geometry' | 'eq' | 'lumetri' | 'lut' | 'chromakey' | 'alpha' | 'opaque';

export interface StageDef {
  sksl: string;
  /** Child shader names in declaration order (`makeShaderWithChildren`'s children). */
  children: readonly string[];
  /** `getUniformFloatCount()` of the compiled effect: what the packer fills. */
  uniformFloats: number;
}

export const STAGES: Record<StageId, StageDef> = {
  geometry: { sksl: GEOMETRY_SKSL, children: GEOMETRY_CHILDREN, uniformFloats: GEOMETRY_UNIFORM_FLOATS },
  eq: { sksl: EQ_SKSL, children: EQ_CHILDREN, uniformFloats: EQ_UNIFORM_FLOATS },
  lumetri: { sksl: LUMETRI_SKSL, children: LUMETRI_CHILDREN, uniformFloats: LUMETRI_UNIFORM_FLOATS },
  lut: { sksl: LUT_SKSL, children: LUT_CHILDREN, uniformFloats: LUT_UNIFORM_FLOATS },
  chromakey: { sksl: CHROMA_SKSL, children: CHROMA_CHILDREN, uniformFloats: CHROMA_UNIFORM_FLOATS },
  alpha: { sksl: ALPHA_SKSL, children: ALPHA_CHILDREN, uniformFloats: ALPHA_UNIFORM_FLOATS },
  opaque: { sksl: OPAQUE_SKSL, children: OPAQUE_CHILDREN, uniformFloats: OPAQUE_UNIFORM_FLOATS },
};

export const STAGE_IDS = Object.keys(STAGES) as StageId[];
