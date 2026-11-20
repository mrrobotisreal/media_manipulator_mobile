// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/parityTolerances.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * parityTolerances — the machine-readable preview↔export parity contract
 * (part 12; ADR ws/0002). The part-13 harness renders each golden-EDL scenario
 * through BOTH pipelines (headless WebGL capture vs ffmpeg frame) and asserts
 * the metric against these thresholds. The prose companion with per-divergence
 * rationale lives at docs/content-studio/design/03-parity-tolerances.md.
 *
 * INITIAL VALUES ARE REASONED, NOT MEASURED: every threshold below must be
 * calibrated on the workstation against the identity-EDL noise floor (render
 * the SAME passthrough EDL through both pipelines; the measured PSNR is the
 * ceiling any effect scenario can hope for) — see research ticket 02's Answer
 * (.scratch/darkroom-v3/issues/02-…md). Until calibrated, treat a failure
 * within ~2 dB / ~0.5 ΔE of the threshold as "recalibrate", not "regression".
 */

/** psnr: minimum acceptable dB (higher = closer). deltaE: maximum acceptable mean CIEDE2000 (lower = closer). */
export type ParityMetric = 'psnr' | 'deltaE';

export type ParityStatus =
  /** both sides state and implement the same math; residual = quantization/colorspace roundtrips */
  | 'closed'
  /** a known, intentional approximation remains — the threshold carries extra headroom */
  | 'bounded';

export interface ParityTolerance {
  /** Golden-EDL scenario id — the part-13 harness names its EDL fixtures after these. */
  id: string;
  metric: ParityMetric;
  threshold: number;
  status: ParityStatus;
  /** What dominates the residual error (why the threshold is where it is). */
  note: string;
}

export const PARITY_TOLERANCES: readonly ParityTolerance[] = [
  {
    id: 'passthrough',
    metric: 'psnr',
    threshold: 40,
    status: 'closed',
    note: 'noise floor: yuv420p 4:2:0 roundtrip + scaler kernel differences; calibration anchor for every other row',
  },
  {
    id: 'transform_position_scale',
    metric: 'psnr',
    threshold: 38,
    status: 'closed',
    note: 'same transform spec both sides; resampling kernels differ (GL bilinear vs ffmpeg scaler)',
  },
  {
    id: 'transform_rotation',
    metric: 'psnr',
    threshold: 34,
    status: 'bounded',
    note: 'edge antialiasing differs (GL quad sampling vs ffmpeg rotate bilinear + alpha pad)',
  },
  {
    id: 'crop',
    metric: 'psnr',
    threshold: 40,
    status: 'closed',
    note: 'exact spec both sides; residual = passthrough noise floor',
  },
  {
    id: 'opacity_dissolve',
    metric: 'psnr',
    threshold: 38,
    status: 'closed',
    note: 'linear alpha both sides by spec; straight-alpha overlay vs shader mix on subsampled chroma',
  },
  {
    id: 'eq_adjustments',
    metric: 'psnr',
    threshold: 36,
    status: 'closed',
    note: 'same decoupled luma/chroma math; luma coefficient ambiguity (BT.601 vs 709 tagging) at high saturation',
  },
  {
    id: 'lumetri_exposure',
    metric: 'psnr',
    threshold: 38,
    status: 'closed',
    note: 'c·2^exposure both sides; residual = clamp + 8-bit quantization',
  },
  {
    id: 'lumetri_temp_tint',
    metric: 'deltaE',
    threshold: 2.5,
    status: 'closed',
    note: 'shader mirrors colorbalance midtone curve exactly; residual = RGB roundtrip quantization',
  },
  {
    id: 'lumetri_contrast_saturation',
    metric: 'psnr',
    threshold: 36,
    status: 'closed',
    note: 'eq-equivalent math both sides; same luma-coefficient ambiguity as eq_adjustments',
  },
  {
    id: 'lumetri_vibrance',
    metric: 'deltaE',
    threshold: 3,
    status: 'closed',
    note: "shader mirrors vf_vibrance (incl. its swapped r/b luma weights); float vs 8-bit lerp rounding",
  },
  {
    id: 'lut_full',
    metric: 'psnr',
    threshold: 35,
    status: 'closed',
    note: 'trilinear both sides; GL RGB8 3D texture quantizes LUT entries vs ffmpeg float lattice',
  },
  {
    id: 'lut_intensity',
    metric: 'psnr',
    threshold: 35,
    status: 'closed',
    note: 'linear mix(c, graded, intensity) both sides (export orientation fixed in part 12)',
  },
  {
    id: 'chromakey',
    metric: 'psnr',
    threshold: 30,
    status: 'bounded',
    note: 'UV-distance key both sides, but ffmpeg keys on 4:2:0-subsampled chroma vs full-res shader — edge fringe differs',
  },
  {
    id: 'blend_multiply',
    metric: 'psnr',
    threshold: 33,
    status: 'closed',
    note: 'per-RGB-channel blend + alpha-windowed merge both sides; residual = gbrp↔yuv roundtrips',
  },
  {
    id: 'blend_screen',
    metric: 'psnr',
    threshold: 33,
    status: 'closed',
    note: 'same as blend_multiply',
  },
  {
    id: 'blend_overlay',
    metric: 'psnr',
    threshold: 32,
    status: 'bounded',
    note: 'branch point 128/255 (ffmpeg) vs 0.5 (shader) splits a hairline band at the midtone boundary',
  },
  {
    id: 'blend_lighten',
    metric: 'psnr',
    threshold: 33,
    status: 'closed',
    note: 'same as blend_multiply',
  },
  {
    id: 'blend_darken',
    metric: 'psnr',
    threshold: 33,
    status: 'closed',
    note: 'same as blend_multiply',
  },
  {
    id: 'blend_addition',
    metric: 'psnr',
    threshold: 33,
    status: 'closed',
    note: 'same as blend_multiply',
  },
  {
    id: 'blend_difference',
    metric: 'psnr',
    threshold: 33,
    status: 'closed',
    note: 'same as blend_multiply',
  },
  {
    id: 'effect_stack_first_per_type',
    metric: 'psnr',
    threshold: 40,
    status: 'closed',
    note: 'policy check: an EDL with duplicate same-type effects must render identically to the first-enabled-only EDL on both sides',
  },
  // --- Part 14: typed transitions (crossDissolve rides opacity_dissolve). ---
  // CSS-fallback preview degrades every type to an alpha ramp — that mode is
  // documented, not measured; these rows hold the WebGL preview vs the export.
  {
    id: 'transition_dip',
    metric: 'psnr',
    threshold: 36,
    status: 'closed',
    note: 'same triangle-alpha color layer both sides (solid GL quad vs ffmpeg color+fade); residual = yuv roundtrip at partial alpha',
  },
  {
    id: 'transition_wipe',
    metric: 'psnr',
    threshold: 34,
    status: 'bounded',
    note: 'canvas-space reveal both sides, but the edge quantizes differently (GL fragment mask vs ffmpeg even-pixel crop) — a 1px seam band per frame',
  },
  {
    id: 'transition_push',
    metric: 'psnr',
    threshold: 34,
    status: 'bounded',
    note: 'same lerped offsets both sides; GL subpixel positioning vs ffmpeg integer overlay x/y shifts edges by <1px mid-motion',
  },
  {
    id: 'transition_slide',
    metric: 'psnr',
    threshold: 34,
    status: 'bounded',
    note: 'same as transition_push (entering clip only; outgoing static)',
  },
  // --- Part 15: keyframing. Both sides evaluate the SAME ease curves
  // (ease.fixtures.json is the contract), so the residual is the underlying
  // transform/color tolerance sampled mid-animation. ---
  {
    id: 'keyframe_transform',
    metric: 'psnr',
    threshold: 33,
    status: 'bounded',
    note: 'animated position+scale+rotation+opacity: same curves both sides; export adds an eval=frame resample stage (fit-to-max then per-frame downscale) and even-pixel rounding vs GL subpixel quads',
  },
  {
    id: 'keyframe_lumetri',
    metric: 'deltaE',
    threshold: 3,
    status: 'bounded',
    note: 'sendcmd-driven eq/colorbalance/vibrance/exposure ramps vs per-frame shader uniforms; command delivery quantizes to frames (≤1 frame skew) on top of the static lumetri residuals',
  },
  // --- Part 16: title clips. Both sides state the SHARED TITLE LAYOUT SPEC
  // (titleRaster.ts ↔ titleLayerParts in studio_export.go): same line/anchor
  // math, same shipped font files. The residual is glyph RASTERIZATION —
  // browser font engine vs FreeType — plus the documented export degradations
  // (letter-spacing, shadow blur, background corner radius + per-axis padding,
  // diagonal-line staircase), all preview-only richness.
  {
    id: 'title_layers',
    metric: 'psnr',
    threshold: 30,
    status: 'bounded',
    note: 'multi-layer title (rect + styled multi-line text + line) over video: same layout math + font files both sides; residual = browser-vs-FreeType glyph AA, canvas middle-baseline vs drawtext text_h centering, and the dropped radius/blur/letter-spacing',
  },
  {
    id: 'title_fonts',
    metric: 'psnr',
    threshold: 32,
    status: 'bounded',
    note: 'per-font-batch goldens (one text layer per shipped family, 3 batches): residual = glyph rasterizer + hinting differences per family; a regression here usually means the UI and server font sets drifted (04-title-fonts.md invariant)',
  },
  // --- MM15: still images. Export loops the ORIGINAL still (-loop 1 -t) through
  // format=rgba + a bt709 yuva420p conversion; the preview samples the decoded
  // proxy-quality bitmap in sRGB. Thresholds are REASONED, NOT MEASURED. ---
  {
    id: 'image_hold_passthrough',
    metric: 'psnr',
    threshold: 38,
    status: 'bounded',
    note: 'reasoned, not measured: held photo, identity transform; bt709 matrix + sRGB proxy vs original; calibrate against the identity-EDL noise floor',
  },
  {
    id: 'image_hold_transform',
    metric: 'psnr',
    threshold: 38,
    status: 'bounded',
    note: 'reasoned, not measured: held photo with scale + rotation + position keyframe; bt709 matrix + sRGB proxy vs original; calibrate against the identity-EDL noise floor',
  },
  {
    id: 'image_hold_dissolve_to_video',
    metric: 'psnr',
    threshold: 36,
    status: 'bounded',
    note: 'reasoned, not measured: video dissolving into a held photo; bt709 matrix + sRGB proxy vs original; calibrate against the identity-EDL noise floor',
  },
  {
    id: 'image_alpha_over_video',
    metric: 'psnr',
    threshold: 38,
    status: 'bounded',
    note: 'reasoned, not measured: RGBA PNG over video; bt709 matrix + sRGB proxy vs original; calibrate against the identity-EDL noise floor',
  },
  // --- Part 17: speed controls. Both pipelines SAMPLE frames (no optical flow):
  // the export retimes with setpts, the preview seeks the mapped source time.
  // Thresholds are REASONED, NOT MEASURED (workstation calibration pending);
  // frame-boundary rounding differs by up to half an output frame, so sample
  // frames sit away from clip boundaries. ---
  {
    id: 'speed_up',
    metric: 'psnr',
    threshold: 36,
    status: 'bounded',
    note: 'reasoned, not measured: 2x via setpts=(PTS-STARTPTS)/2 vs preview seek of sourceIn+u*2; residual = which source frame each side picks (half-frame rounding) on a moving test pattern',
  },
  {
    id: 'speed_slow',
    metric: 'psnr',
    threshold: 36,
    status: 'bounded',
    note: 'reasoned, not measured: 0.5x slow-mo repeats source frames; the preview holds the decoded frame, the export holds via fps; a one-frame phase difference is the residual',
  },
  {
    id: 'speed_reverse',
    metric: 'psnr',
    threshold: 35,
    status: 'bounded',
    note: 'reasoned, not measured: preview reads the reversed proxy fixture at mirrored time, the export applies reverse to the trimmed original; reversed GOP seeks can land one frame off',
  },
  {
    id: 'speed_freeze',
    metric: 'psnr',
    threshold: 38,
    status: 'closed',
    note: 'reasoned, not measured: both sides hold the one decoded frame (tpad=clone vs constant sourceTime); only the frame pick at the 1.5 s seek can differ',
  },
] as const;

export function parityTolerance(id: string): ParityTolerance | undefined {
  return PARITY_TOLERANCES.find((t) => t.id === id);
}
