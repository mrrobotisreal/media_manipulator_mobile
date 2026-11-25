/**
 * Stage 5: lumetri. Ported from media-manipulator-ui `lib/studio/glCompositor.ts` (UI commit
 * e9820f7) `applyLumetri`, line for line: colorchannelmixer(2^exposure) -> colorbalance midtones ->
 * vibrance -> eq contrast/saturation, clamping between stages like each 8-bit ffmpeg filter. The CPU
 * reference is the copied `studioColorMath.ts` `lumetriAdjust`.
 */
import { COLOR_HELPERS_SKSL, colorStage } from './common';

export const LUMETRI_SKSL = colorStage(
  `uniform float uExposure, uLumContrast, uLumSaturation, uTemperature, uTint, uVibrance;
${COLOR_HELPERS_SKSL}`,
  `  c = clamp(c * exp2(uExposure), 0.0, 1.0);
  float t = uTemperature / 100.0;
  float ti = uTint / 100.0;
  float cbl = 0.5 * (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b)));
  float w = clamp((cbl - 0.333) * 4.0 + 0.5, 0.0, 1.0)
          * clamp((1.0 - cbl - 0.333) * 4.0 + 0.5, 0.0, 1.0) * 0.7;
  c = clamp(c + float3(t, -ti, -t) * w, 0.0, 1.0);
  float vsat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float vl = dot(c, VIB_LUMA);
  float vf = 1.0 + uVibrance * (1.0 - sign(uVibrance) * vsat);
  c = clamp(mix(float3(vl), c, vf), 0.0, 1.0);
  c = applyEqCS(c, 0.0, uLumContrast, uLumSaturation);`,
);
export const LUMETRI_CHILDREN = ['uIn'] as const;
export const LUMETRI_UNIFORM_FLOATS = 6;
