/**
 * Stage 4: eq (the clip's legacy `adjustments`). Ported from media-manipulator-ui
 * `lib/studio/glCompositor.ts` (UI commit e9820f7) `applyEq` / `applyEqCS`, line for line; the CPU
 * reference is the copied `studioColorMath.ts` `eqAdjust`.
 */
import { COLOR_HELPERS_SKSL, colorStage } from './common';

export const EQ_SKSL = colorStage(
  `uniform float3 uEq; // brightness, contrast, saturation
${COLOR_HELPERS_SKSL}`,
  `  c = applyEqCS(c, uEq.x, uEq.y, uEq.z);`,
);
export const EQ_CHILDREN = ['uIn'] as const;
export const EQ_UNIFORM_FLOATS = 3;
