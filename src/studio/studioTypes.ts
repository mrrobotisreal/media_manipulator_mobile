// DO NOT EDIT. Copied from media-manipulator-ui lib/studioTypes.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { z } from 'zod';

/**
 * Content Studio EDL (Edit Decision List) — the shared contract between the
 * React editor and the Go API. Field names are camelCase and MUST stay
 * identical to the Go structs in internal/models/studio.go. The browser
 * previews from this list (Option A: pooled <video> elements + Web Audio); the
 * server only re-reads it at export time to build the ffmpeg filter_complex
 * graph.
 *
 * Zod is the single source of truth here: TS types are inferred from the
 * schemas so a drift between the two is impossible.
 */

export const studioMediaKindSchema = z.enum(['video', 'audio', 'lut', 'image']);
export type StudioMediaKind = z.infer<typeof studioMediaKindSchema>;

export const studioTrackKindSchema = z.enum(['video', 'audio']);
export type StudioTrackKind = z.infer<typeof studioTrackKindSchema>;

/** Per-clip color adjustments (ffmpeg `eq` / CSS filters). */
export const studioAdjustmentsSchema = z.object({
  brightness: z.number().min(-1).max(1), // 0 = none
  contrast: z.number().min(0).max(2), // 1 = none
  saturation: z.number().min(0).max(2), // 1 = none
});
export type StudioAdjustments = z.infer<typeof studioAdjustmentsSchema>;

/** A text/location label drawn over a clip (e.g. on drone footage). */
export const studioTextOverlaySchema = z.object({
  id: z.string(),
  text: z.string().max(200),
  x: z.number().min(0).max(1), // normalized position within the frame
  y: z.number().min(0).max(1),
  fontSize: z.number().positive(), // project-resolution pixels
  color: z.string(), // #RRGGBB
});
export type StudioTextOverlay = z.infer<typeof studioTextOverlaySchema>;

// ---------------------------------------------------------------------------
// EDL v2 — Motion / Crop / Blend / Effects / Audio keyframes (all optional and
// all defaulting to "no effect"). Parameter names + ranges are mirrored
// byte-for-byte by internal/models/studio.go and the WebGL/ffmpeg emitters; the
// canonical table lives in lib/studio/effectRegistry.ts.
// ---------------------------------------------------------------------------

/**
 * Per-clip 2D transform. x/y are normalized offsets of the clip center from the
 * frame center (fractions of project width/height). scale is uniform. rotation
 * is degrees clockwise.
 */
export const studioTransformSchema = z.object({
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  scale: z.number().min(0.01).max(10).default(1),
  rotationDeg: z.number().min(-360).max(360).default(0),
});
export type StudioTransform = z.infer<typeof studioTransformSchema>;

/**
 * Normalized fractions cropped from each edge of the SOURCE frame. The refine
 * keeps a non-empty region; the Go side clamps identically.
 */
export const studioCropSchema = z
  .object({
    left: z.number().min(0).max(1).default(0),
    top: z.number().min(0).max(1).default(0),
    right: z.number().min(0).max(1).default(0),
    bottom: z.number().min(0).max(1).default(0),
  })
  .refine((c) => c.left + c.right < 1 && c.top + c.bottom < 1, {
    message: 'crop edges must leave a non-empty region',
  });
export type StudioCrop = z.infer<typeof studioCropSchema>;

/**
 * Layer blend modes. Exactly this set: every member exists in ffmpeg's
 * `blend=all_mode=` AND has a standard separable blend equation we implement in
 * the WebGL shader.
 */
export const studioBlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'lighten',
  'darken',
  'addition',
  'difference',
]);
export type StudioBlendMode = z.infer<typeof studioBlendModeSchema>;

/** Lumetri-style primary color grade. */
export const studioLumetriEffectSchema = z.object({
  type: z.literal('lumetri'),
  id: z.string(),
  enabled: z.boolean().default(true),
  exposure: z.number().min(-3).max(3).default(0), // stops; gain = 2^exposure
  contrast: z.number().min(0).max(2).default(1),
  saturation: z.number().min(0).max(2).default(1),
  temperature: z.number().min(-100).max(100).default(0),
  tint: z.number().min(-100).max(100).default(0),
  vibrance: z.number().min(-2).max(2).default(0),
});
export type StudioLumetriEffect = z.infer<typeof studioLumetriEffectSchema>;

/** A 3D LUT (.cube) applied at `intensity` (0..1 mix with the ungraded pixel). */
export const studioLutEffectSchema = z.object({
  type: z.literal('lut'),
  id: z.string(),
  enabled: z.boolean().default(true),
  lutAssetId: z.string(),
  intensity: z.number().min(0).max(1).default(1),
});
export type StudioLutEffect = z.infer<typeof studioLutEffectSchema>;

/** Green/blue-screen chroma key (UV-distance, matching ffmpeg `chromakey`). */
export const studioChromaKeyEffectSchema = z.object({
  type: z.literal('chromakey'),
  id: z.string(),
  enabled: z.boolean().default(true),
  keyColor: z.string().default('#00FF00'), // #RRGGBB
  similarity: z.number().min(0.01).max(1).default(0.1),
  blend: z.number().min(0).max(1).default(0.1),
  despill: z.number().min(0).max(1).default(0.5),
});
export type StudioChromaKeyEffect = z.infer<typeof studioChromaKeyEffectSchema>;

/** An ordered, toggleable effect in a clip's effect stack. */
export const studioEffectSchema = z.discriminatedUnion('type', [
  studioLumetriEffectSchema,
  studioLutEffectSchema,
  studioChromaKeyEffectSchema,
]);
export type StudioEffect = z.infer<typeof studioEffectSchema>;
export type StudioEffectType = StudioEffect['type'];

/** A volume automation point. `t` is seconds from the clip's timeline start. */
export const studioVolumeKeyframeSchema = z.object({
  t: z.number().min(0),
  gain: z.number().min(0).max(2), // +6dB ceiling, like Premiere
});
export type StudioVolumeKeyframe = z.infer<typeof studioVolumeKeyframeSchema>;

// ---------------------------------------------------------------------------
// EDL v3 — typed transitions, per-property keyframes, title clips, speed, track
// mixer/effects, project markers (ADR ws/0004). All additive and inert until
// parts 14–21 light them up. Ranges mirror STUDIO_V3_RANGES in
// lib/studio/effectRegistry.ts and the Go sanitizer.
// ---------------------------------------------------------------------------

/** How a clip enters over its predecessor's overlap region (supersedes `transitionInSeconds`). */
export const studioTransitionTypeSchema = z.enum([
  'crossDissolve',
  'dipToBlack',
  'dipToWhite',
  'wipeLeft',
  'wipeRight',
  'wipeUp',
  'wipeDown',
  'pushLeft',
  'pushRight',
  'pushUp',
  'pushDown',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
]);
export type StudioTransitionType = z.infer<typeof studioTransitionTypeSchema>;

export const studioTransitionSchema = z.object({
  type: studioTransitionTypeSchema,
  durationSeconds: z.number().min(0.1).max(5),
  /** per-type tuning params (defined by part 14; pass-through until then). */
  params: z.record(z.string(), z.number()).optional(),
});
export type StudioTransition = z.infer<typeof studioTransitionSchema>;

export const studioKeyframeEaseSchema = z.enum(['linear', 'hold', 'easeIn', 'easeOut', 'easeBoth']);
export type StudioKeyframeEase = z.infer<typeof studioKeyframeEaseSchema>;

/** One automation point. `t` is clip-local seconds; arrays are sorted by t. */
export const studioKeyframeSchema = z.object({
  t: z.number().min(0),
  value: z.number(),
  ease: studioKeyframeEaseSchema,
});
export type StudioKeyframe = z.infer<typeof studioKeyframeSchema>;

/** ≤64 points per property (mirrors the legacy volumeKeyframes cap). */
const studioKeyframeArraySchema = z.array(studioKeyframeSchema).max(64);

/**
 * Per-property keyframe lanes. `effects` keys are `<effectId>.<param>` (e.g.
 * `lumetri1.exposure`), sanitized server-side against the effect registry's
 * ranges. `volume` supersedes legacy `volumeKeyframes` (normalizeProject
 * upgrades; `keyframes.volume` wins when both exist).
 */
export const studioClipKeyframesSchema = z.object({
  positionX: studioKeyframeArraySchema.optional(),
  positionY: studioKeyframeArraySchema.optional(),
  scale: studioKeyframeArraySchema.optional(),
  rotation: studioKeyframeArraySchema.optional(),
  opacity: studioKeyframeArraySchema.optional(),
  volume: studioKeyframeArraySchema.optional(),
  pan: studioKeyframeArraySchema.optional(),
  effects: z.record(z.string(), studioKeyframeArraySchema).optional(),
});
export type StudioClipKeyframes = z.infer<typeof studioClipKeyframesSchema>;

export const studioTitleShadowSchema = z.object({
  xPx: z.number(),
  yPx: z.number(),
  blurPx: z.number(),
  color: z.string(),
});
export type StudioTitleShadow = z.infer<typeof studioTitleShadowSchema>;

export const studioTitleBackgroundSchema = z.object({
  color: z.string(),
  opacity: z.number().min(0).max(1),
  paddingXPx: z.number(),
  paddingYPx: z.number(),
  radiusPx: z.number(),
});
export type StudioTitleBackground = z.infer<typeof studioTitleBackgroundSchema>;

/** Text block. x/y are normalized 0–1 (center of the block), like textOverlays. */
export const studioTitleTextLayerSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(500),
  fontFamily: z.string(),
  fontSizePx: z.number().positive(),
  fontWeight: z.union([z.literal(400), z.literal(700)]),
  fillColor: z.string(),
  strokeColor: z.string().optional(),
  strokeWidthPx: z.number().optional(),
  shadow: studioTitleShadowSchema.optional(),
  background: studioTitleBackgroundSchema.optional(),
  letterSpacingPx: z.number().optional(),
  lineHeight: z.number().optional(),
  align: z.enum(['left', 'center', 'right']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type StudioTitleTextLayer = z.infer<typeof studioTitleTextLayerSchema>;

/** Solid rectangle. Coordinates and sizes are normalized 0–1. */
export const studioTitleRectLayerSchema = z.object({
  type: z.literal('rect'),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  color: z.string(),
  opacity: z.number().min(0).max(1).optional(),
  radiusPx: z.number().optional(),
});
export type StudioTitleRectLayer = z.infer<typeof studioTitleRectLayerSchema>;

/** Straight line segment. Endpoints normalized 0–1. */
export const studioTitleLineLayerSchema = z.object({
  type: z.literal('line'),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
  color: z.string(),
  thicknessPx: z.number().positive(),
});
export type StudioTitleLineLayer = z.infer<typeof studioTitleLineLayerSchema>;

export const studioTitleLayerSchema = z.discriminatedUnion('type', [
  studioTitleTextLayerSchema,
  studioTitleRectLayerSchema,
  studioTitleLineLayerSchema,
]);
export type StudioTitleLayer = z.infer<typeof studioTitleLayerSchema>;

/**
 * Presence makes the clip a TITLE CLIP: assetless (empty `assetId`), rendered
 * from the layer stack. The sanitizer enforces assetId XOR title.
 */
export const studioTitleSchema = z.object({
  layers: z.array(studioTitleLayerSchema).max(8),
});
export type StudioTitle = z.infer<typeof studioTitleSchema>;

/** Held-frame clip. Mutually exclusive with speed/reverse (sanitizer enforces). */
export const studioFreezeSchema = z.object({
  sourceTime: z.number().min(0), // seconds within the source media
});
export type StudioFreeze = z.infer<typeof studioFreezeSchema>;

/** Track 3-band EQ (shelf gains, dB). */
export const studioTrackEqSchema = z.object({
  lowGainDb: z.number().min(-12).max(12),
  midGainDb: z.number().min(-12).max(12),
  highGainDb: z.number().min(-12).max(12),
});
export type StudioTrackEq = z.infer<typeof studioTrackEqSchema>;

export const studioTrackCompressorSchema = z.object({
  thresholdDb: z.number().min(-60).max(0),
  ratio: z.number().min(1).max(20),
  attackMs: z.number().min(1).max(200),
  releaseMs: z.number().min(20).max(1000),
  makeupDb: z.number().min(0).max(12),
});
export type StudioTrackCompressor = z.infer<typeof studioTrackCompressorSchema>;

export const studioTrackEffectsSchema = z.object({
  eq: studioTrackEqSchema.optional(),
  compressor: studioTrackCompressorSchema.optional(),
});
export type StudioTrackEffects = z.infer<typeof studioTrackEffectsSchema>;

/** A named point of interest on the project timeline (`t` in seconds). */
export const studioMarkerSchema = z.object({
  id: z.string(),
  t: z.number().min(0),
  name: z.string().max(80),
  color: z.string(), // #RRGGBB
  comment: z.string().max(500).optional(),
});
export type StudioMarker = z.infer<typeof studioMarkerSchema>;

/** A placement of a source asset's stream on the timeline. */
export const studioClipSchema = z.object({
  id: z.string(),
  /**
   * v3: optional on the wire — a title clip has no asset. Absence is
   * represented as '' (Go's string zero value) so the inferred TS type stays
   * `string` and asset lookups keep working; the sanitizer enforces
   * assetId XOR title.
   */
  assetId: z.string().default(''),
  /** which source stream (usually 0 video / 0 audio) */
  streamIndex: z.number().int().min(0).default(0),
  /** seconds on the timeline */
  timelineStart: z.number().min(0),
  /** in-point within the source media (seconds) */
  sourceIn: z.number().min(0),
  /** out-point within the source media (seconds); effective duration = sourceOut - sourceIn */
  sourceOut: z.number().min(0),
  /** 0..2 for audio (default 1; >1 = boost, like Premiere). Overridden by volumeKeyframes when present. */
  volume: z.number().min(0).max(2).optional(),
  /** 0..1 for video (default 1) */
  opacity: z.number().min(0).max(1).optional(),
  /** cross-dissolve duration from the previous clip on the same track */
  transitionInSeconds: z.number().min(0).optional(),
  adjustments: studioAdjustmentsSchema.optional(),
  textOverlays: z.array(studioTextOverlaySchema).optional(),

  // --- EDL v2 (all optional; absent = no effect) ---
  /** 2D motion: position / scale / rotation within the project frame. */
  transform: studioTransformSchema.optional(),
  /** Edge crop of the source frame. */
  crop: studioCropSchema.optional(),
  /** Layer blend mode against the running composite (default 'normal'). */
  blendMode: studioBlendModeSchema.optional(),
  /** Ordered effect stack (lumetri / lut / chromakey). */
  effects: z.array(studioEffectSchema).optional(),
  /** Volume automation; when non-empty it overrides the flat `volume`. */
  volumeKeyframes: z.array(studioVolumeKeyframeSchema).optional(),
  /** Stereo balance −1 (L) .. 1 (R). */
  pan: z.number().min(-1).max(1).optional(),

  // --- EDL v3 (all optional; absent = no effect) ---
  /** Typed clip-edge transition; reading prefers this over `transitionInSeconds`. */
  transition: studioTransitionSchema.optional(),
  /** Per-property automation lanes. `keyframes.volume` supersedes `volumeKeyframes`. */
  keyframes: studioClipKeyframesSchema.optional(),
  /** Presence makes this a title clip (assetless). */
  title: studioTitleSchema.optional(),
  /** Playback rate 0.1–10 (default 1). */
  speed: z.number().min(0.1).max(10).optional(),
  /** Play the source segment backwards. */
  reverse: z.boolean().optional(),
  /** Preserve audio pitch under speed change (default true when absent). */
  maintainPitch: z.boolean().optional(),
  /** Held-frame clip; mutually exclusive with speed/reverse. */
  freeze: studioFreezeSchema.optional(),
  /** Clip grouping (part 18). */
  groupId: z.string().optional(),
});
export type StudioClip = z.infer<typeof studioClipSchema>;

/** One timeline lane. */
export const studioTrackSchema = z.object({
  id: z.string(),
  kind: studioTrackKindSchema,
  /** V1=0,V2=1… / A1=0,A2=1… */
  index: z.number().int().min(0),
  muted: z.boolean().default(false),
  clips: z.array(studioClipSchema).default([]),

  // --- EDL v3 (all optional; absent = default behavior) ---
  /** User-visible lane name. */
  name: z.string().max(80).optional(),
  /** Locked tracks reject edits (part 18). */
  locked: z.boolean().optional(),
  /** Hide a video track from the composite. */
  hidden: z.boolean().optional(),
  /** Solo an audio track in the mix. */
  solo: z.boolean().optional(),
  /** Track gain 0–2 (default 1). */
  gain: z.number().min(0).max(2).optional(),
  /** Track stereo balance −1 (L) .. 1 (R) (default 0). */
  pan: z.number().min(-1).max(1).optional(),
  /** Track insert effects (3-band EQ, compressor). */
  effects: studioTrackEffectsSchema.optional(),
});
export type StudioTrack = z.infer<typeof studioTrackSchema>;

// ---------------------------------------------------------------------------
// Captions + audio ducking — project-level (not per-track). Persisted in the
// `captions` JSONB sidecar column so the autosave PUT and the caption-generate
// job don't clobber each other.
// ---------------------------------------------------------------------------

/** One timed word of a cue (MM121). `emphasis` colours it with the highlight for the whole cue. */
export const studioCaptionWordSchema = z.object({
  text: z.string().min(1).max(100),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  emphasis: z.boolean().optional(),
  /** MM122: Whisper's times before the first hand retime ("Re-time from audio" restores them). */
  origStartSeconds: z.number().min(0).optional(),
  origEndSeconds: z.number().min(0).optional(),
});
export type StudioCaptionWord = z.infer<typeof studioCaptionWordSchema>;

/** One caption cue rendered on the dedicated caption lane / burned at export. */
export const studioCaptionCueSchema = z.object({
  id: z.string(),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  text: z.string().max(500),
  /** MM121 (additive): one entry per caption unit of `text` (lib/studio/captions/units.ts), ≤ 64. */
  words: z.array(studioCaptionWordSchema).max(64).optional(),
});
export type StudioCaptionCue = z.infer<typeof studioCaptionCueSchema>;

/** MM121 caption animations (MM122 adds the rest). Mirrors models.CaptionAnimations. */
export const STUDIO_CAPTION_ANIMATIONS = ['none', 'karaoke_fill', 'highlight', 'pop', 'bounce', 'word_by_word', 'box_highlight', 'fade', 'typewriter', 'glow'] as const;
export type StudioCaptionAnimation = (typeof STUDIO_CAPTION_ANIMATIONS)[number];
export const STUDIO_CAPTION_BACKGROUND_MODES = ['box', 'none', 'word_box'] as const;
/** The twelve caption looks, MM121's six then MM122's (lib/studio/captions/captionLooks.ts; mirrors models.StudioCaptionLooks). */
export const STUDIO_CAPTION_LOOK_IDS = [
  'bold_pop', 'karaoke_classic', 'clean_highlight', 'minimal', 'neon', 'podcast',
  'cinema', 'comic', 'typewriter', 'box_pop', 'glow_night', 'bounce_kids',
] as const;
export type StudioCaptionLookId = (typeof STUDIO_CAPTION_LOOK_IDS)[number];

/**
 * Project-wide caption appearance. fontSizePct is a % of project height. The MM121 fields are all
 * optional (absent on older projects, which round-trip unchanged); absent fields take the
 * defaults in lib/studio/captions/captionsCatalog.json.
 */
export const studioCaptionStyleSchema = z.object({
  fontSizePct: z.number().min(1).max(15).default(4.5),
  color: z.string().default('#FFFFFF'),
  backgroundColor: z.string().default('#000000'),
  backgroundOpacity: z.number().min(0).max(1).default(0.55),
  position: z.enum(['bottom', 'middle', 'top']).default('bottom'),
  maxWidthPct: z.number().min(40).max(100).default(90),
  fontFamily: z.string().max(64).optional(),
  bold: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  highlightColor: z.string().optional(),
  outlineColor: z.string().optional(),
  /** Outline width in px at 1080p, 0–12. */
  outlineWidth: z.number().min(0).max(12).optional(),
  /** Drop shadow, 0–1. */
  shadow: z.number().min(0).max(1).optional(),
  backgroundMode: z.enum(STUDIO_CAPTION_BACKGROUND_MODES).optional(),
  /** Words on screen at once, 1–6; absent = the whole cue. */
  wordsPerGroup: z.number().int().min(1).max(6).optional(),
  animation: z.enum(STUDIO_CAPTION_ANIMATIONS).optional(),
  animationStrength: z.number().min(0).max(1).optional(),
  /** The caption look the style started from (kept after tweaks; the editor shows "modified"). */
  lookId: z.enum(STUDIO_CAPTION_LOOK_IDS).optional(),
});
export type StudioCaptionStyle = z.infer<typeof studioCaptionStyleSchema>;

/** Sensible default caption style so the UI always has one to render. */
export const DEFAULT_CAPTION_STYLE: StudioCaptionStyle = {
  fontSizePct: 4.5,
  color: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.55,
  position: 'bottom',
  maxWidthPct: 90,
};

/** Sidechain auto-ducking: pull non-voice tracks down while a voice clip plays. */
export const studioAudioConfigSchema = z.object({
  duckingEnabled: z.boolean().default(false),
  duckVoiceTrackId: z.string().optional(),
  duckAmountDb: z.number().min(0).max(24).default(9),
  duckAttackMs: z.number().min(0).max(2000).default(120),
  duckReleaseMs: z.number().min(0).max(5000).default(400),
  /** Project master fader 0–2 (part 19). Absent = unity; stored only when not 1. */
  masterGain: z.number().min(0).max(2).optional(),
});
export type StudioAudioConfig = z.infer<typeof studioAudioConfigSchema>;

/** Current EDL schema version. Older projects are upgraded by normalizeProject. */
export const STUDIO_SCHEMA_VERSION = 3;

/** The persisted editor document. */
export const studioProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** EDL schema version; written as STUDIO_SCHEMA_VERSION on save, upgraded on load. */
  schemaVersion: z.number().int().default(1),
  /** timeline framerate (e.g. 30) */
  fps: z.number().positive(),
  /** timeline resolution */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** computed = end of last clip */
  durationSeconds: z.number().min(0).default(0),
  tracks: z.array(studioTrackSchema).default([]),
  /** caption cues (project-level, rendered on a dedicated lane). */
  captions: z.array(studioCaptionCueSchema).default([]),
  captionStyle: studioCaptionStyleSchema.optional(),
  captionsEnabled: z.boolean().default(true),
  /** auto-ducking config. */
  audio: studioAudioConfigSchema.optional(),
  /** v3: timeline markers (≤500, sorted by t). */
  markers: z.array(studioMarkerSchema).max(500).optional(),
  /**
   * Part 07: server-incremented optimistic-concurrency counter. Not part of
   * the editable document (the store keeps it outside undo history). Optional
   * because a CreaTV backend that doesn't echo it falls back to legacy
   * last-write-wins saves.
   */
  revision: z.number().int().positive().optional(),
  /** RFC3339 */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StudioProject = z.infer<typeof studioProjectSchema>;

/** An ingested source file plus its derived proxy + filmstrip + probe data. */
export const studioAssetSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  originalFileName: z.string(),
  s3KeyOriginal: z.string(),
  s3KeyProxy: z.string().optional(),
  /** filmstrip sprite */
  thumbnailSpriteUrl: z.string().optional(),
  /** audio waveform peaks JSON (present once generated/backfilled) */
  s3KeyPeaks: z.string().optional(),
  /** reversed 720p preview proxy (part 17); present once the reverse_proxy job finished */
  s3KeyProxyReversed: z.string().optional(),
  /**
   * MM71: the video proxy's generation, derived by the API from its key. 0 =
   * built before MM71 (pre-MM70 imports seek slowly), >= 1 = 1 s keyframes.
   * Absent on non-video assets and from APIs without the rebuild route.
   */
  proxyGeneration: z.number().int().min(0).optional(),
  mediaKind: studioMediaKindSchema,
  durationSeconds: z.number().min(0),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  hasAudio: z.boolean(),
  sampleRate: z.number().int().optional(),
  channels: z.number().int().optional(),
  /** full ffprobe payload for debugging */
  probeJson: z.unknown(),
  createdAt: z.string(),
  /**
   * Part 21 bin organization (server state, NOT part of the EDL): rename without
   * touching the original filename, single-level folder name, label color slug.
   * Absent = unset.
   */
  displayName: z.string().optional(),
  folder: z.string().optional(),
  label: z.string().optional(),
});
export type StudioAsset = z.infer<typeof studioAssetSchema>;

// ---------------------------------------------------------------------------
// Request / response schemas for the /api/studio/* endpoints.
// ---------------------------------------------------------------------------

export const studioCreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(200),
  fps: z.number().positive().max(240),
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(4320),
});
export type StudioCreateProjectRequest = z.infer<typeof studioCreateProjectRequestSchema>;

export const studioSaveProjectRequestSchema = z.object({
  name: z.string().min(1).max(200),
  schemaVersion: z.number().int().optional(),
  fps: z.number().positive().max(240),
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(4320),
  tracks: z.array(studioTrackSchema),
  // EDL v2 project-level fields persisted alongside tracks (transactionally).
  captions: z.array(studioCaptionCueSchema).optional(),
  captionStyle: studioCaptionStyleSchema.optional(),
  captionsEnabled: z.boolean().optional(),
  audio: studioAudioConfigSchema.optional(),
  // EDL v3 project-level fields.
  markers: z.array(studioMarkerSchema).max(500).optional(),
  /**
   * Part 07: the revision this save is based on. When set, a stale value gets
   * a 409 (conflict dialog); when omitted the save is legacy last-write-wins
   * (embed back-compat — the MM client always sends it when it has one).
   */
  expectedRevision: z.number().int().positive().optional(),
});
export type StudioSaveProjectRequest = z.infer<typeof studioSaveProjectRequestSchema>;

export const studioAssetPresignRequestSchema = z.object({
  projectId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  fileSizeBytes: z.number().int().positive(),
  sessionId: z.string().optional(),
});
export type StudioAssetPresignRequest = z.infer<typeof studioAssetPresignRequestSchema>;

export const studioAssetPresignResponseSchema = z.object({
  uploadUrl: z.string(),
  s3Key: z.string(),
  bucket: z.string(),
  expiresAt: z.string(),
});
export type StudioAssetPresignResponse = z.infer<typeof studioAssetPresignResponseSchema>;

export const studioAssetCompleteRequestSchema = z.object({
  projectId: z.string(),
  s3Key: z.string(),
  fileName: z.string(),
  contentType: z.string().optional(),
  fileSizeBytes: z.number().int().optional(),
});
export type StudioAssetCompleteRequest = z.infer<typeof studioAssetCompleteRequestSchema>;

export const studioAssetCompleteResponseSchema = z.object({
  asset: studioAssetSchema,
  jobId: z.string(),
});
export type StudioAssetCompleteResponse = z.infer<typeof studioAssetCompleteResponseSchema>;

export const studioLoudnessPresetSchema = z.enum(['', 'streaming', 'podcast', 'broadcast']);
export type StudioLoudnessPreset = z.infer<typeof studioLoudnessPresetSchema>;

/**
 * Legacy export formats (part 20): H.264/HEVC render an MP4; mp3/wav are audio-only. Since
 * MM118 an ALIAS of the output fields (the CreaTV embed sends it, or nothing).
 */
export const studioExportFormatSchema = z.enum(['h264', 'hevc', 'mp3', 'wav']);
export type StudioExportFormat = z.infer<typeof studioExportFormatSchema>;

/**
 * MM118: the derived output label a history row and analytics carry: a legacy name for the
 * four combinations `format` always meant, else `<container>_<video>_<audio>`. The closed
 * list is the API output table's `formats` (lib/studio/studioOutputs.json); a string here so
 * a newer API's row still parses (the panel falls back to the raw parts).
 */
export const studioOutputLabelSchema = z.string().min(1).max(40);

/** One explicit captions choice per export (part 20). */
// MM119: `embedded` muxes the cues as a plain-text subtitle stream (Premium+, video containers only).
export const studioCaptionsModeSchema = z.enum(['none', 'burn_in', 'sidecar', 'embedded']);
export type StudioCaptionsMode = z.infer<typeof studioCaptionsModeSchema>;

/** The output-height ladder the server accepts (0 = the project's canvas). */
export const STUDIO_EXPORT_RESOLUTIONS = [0, 2160, 1440, 1080, 720] as const;
export type StudioExportResolution = (typeof STUDIO_EXPORT_RESOLUTIONS)[number];

export const studioExportRequestSchema = z.object({
  fileName: z.string().optional(),
  preset: z.string().optional(),
  /** loudnorm target preset applied to the master audio (empty = off). */
  loudness: studioLoudnessPresetSchema.optional(),
  /** Part 20 (additive; omitted = h264). An alias since MM118; never sent with the output fields. */
  format: studioExportFormatSchema.optional(),
  /** MM118 output model (additive; from the API's output table). */
  outputPreset: z.string().optional(),
  container: z.string().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  /** kbps from the codec's closed list; omitted = its default. Advanced only. */
  audioBitrate: z.number().int().optional(),
  /** 1 | 2; omitted = stereo. Advanced only. */
  audioChannels: z.number().int().optional(),
  /** Part 20 (additive): output height in px; 0/omitted = the canvas. */
  resolution: z.number().int().optional(),
  /** Part 20 (additive): omitted = legacy (burn in when the project has captions on). */
  captionsMode: studioCaptionsModeSchema.optional(),
});
export type StudioExportRequest = z.infer<typeof studioExportRequestSchema>;

/** One studio_exports row (GET /projects/:id/exports), part 20. */
export const studioExportRecordSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  jobId: z.string(),
  fileName: z.string().optional(),
  preset: z.string().optional(),
  format: studioOutputLabelSchema,
  /** MM118 (additive; the API fills them from `format` for older rows). */
  container: z.string().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  audioBitrate: z.number().int().optional(),
  audioChannels: z.number().int().optional(),
  resolution: z.number().int().default(0),
  captionsMode: studioCaptionsModeSchema.default('none'),
  loudness: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  /** Coarse error class (timeout, unsupported, gpu, interrupted, ...), never raw text. */
  error: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  /** True while the rendered artifact is still inside its retention window. */
  available: z.boolean().default(false),
});
export type StudioExportRecord = z.infer<typeof studioExportRecordSchema>;

// ---------------------------------------------------------------------------
// Version history (part 09) — server-side checkpoints (ADR ws/0001 item 3).
// ---------------------------------------------------------------------------

export const studioVersionKindSchema = z.enum(['auto', 'manual']);
export type StudioVersionKind = z.infer<typeof studioVersionKindSchema>;

/**
 * Version metadata (one list row). Snapshot bodies never travel to the client:
 * restore happens server-side and answers with the full updated project.
 * `revision` is the project revision the snapshot was captured at (optional so
 * a CreaTV backend that doesn't track revisions can still list).
 */
export const studioProjectVersionSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  kind: studioVersionKindSchema,
  name: z.string().optional(),
  revision: z.number().int().optional(),
  createdAt: z.string(),
});
export type StudioProjectVersion = z.infer<typeof studioProjectVersionSchema>;

/** Body for POST /projects/:id/versions. name is required for kind 'manual'. */
export const studioCreateVersionRequestSchema = z.object({
  kind: studioVersionKindSchema,
  name: z.string().max(80).optional(),
});
export type StudioCreateVersionRequest = z.infer<typeof studioCreateVersionRequestSchema>;

// ---------------------------------------------------------------------------
// v1 → v2 → v3 normalizer chain. Called from loadProject; each step is
// idempotent and purely additive (no field relocations), so untouched clips
// and tracks keep their object identity.
// ---------------------------------------------------------------------------

/** v1 → v2: stamp nothing but fill the project-level caption/audio defaults. */
function normalizeToV2(project: StudioProject): StudioProject {
  return {
    ...project,
    captions: project.captions ?? [],
    captionStyle: project.captionStyle ?? { ...DEFAULT_CAPTION_STYLE },
    captionsEnabled: project.captionsEnabled ?? true,
    audio: project.audio,
  };
}

/**
 * v2 → v3 clip upgrades:
 *  - `transitionInSeconds > 0` → `transition: {type: 'crossDissolve', …}`
 *    (legacy field kept — still written for now, dropped in a future contract;
 *    reading prefers `transition`).
 *  - `volumeKeyframes` → `keyframes.volume` with ease 'linear' when
 *    `keyframes.volume` is absent; `keyframes.volume` wins when both exist.
 * Returns the SAME clip object when nothing needs upgrading.
 */
function upgradeClipToV3(clip: StudioClip): StudioClip {
  let out = clip;
  const legacySeconds = clip.transitionInSeconds ?? 0;
  if (!clip.transition && legacySeconds > 0) {
    out = {
      ...out,
      transition: {
        type: 'crossDissolve',
        durationSeconds: Math.min(Math.max(legacySeconds, 0.1), 5),
      },
    };
  }
  if (!clip.keyframes?.volume && clip.volumeKeyframes && clip.volumeKeyframes.length > 0) {
    out = {
      ...out,
      keyframes: {
        ...out.keyframes,
        volume: clip.volumeKeyframes.map((k) => ({ t: k.t, value: k.gain, ease: 'linear' as const })),
      },
    };
  }
  return out;
}

/** v2 → v3 across the track tree, preserving identity when nothing changes. */
function normalizeTracksToV3(tracks: StudioTrack[]): StudioTrack[] {
  let anyChanged = false;
  const next = tracks.map((track) => {
    let clipsChanged = false;
    const clips = track.clips.map((clip) => {
      const upgraded = upgradeClipToV3(clip);
      if (upgraded !== clip) clipsChanged = true;
      return upgraded;
    });
    if (!clipsChanged) return track;
    anyChanged = true;
    return { ...track, clips };
  });
  return anyChanged ? next : tracks;
}

export function normalizeProject(project: StudioProject): StudioProject {
  const v2 = normalizeToV2(project);
  return {
    ...v2,
    schemaVersion: STUDIO_SCHEMA_VERSION,
    tracks: normalizeTracksToV3(v2.tracks),
  };
}
