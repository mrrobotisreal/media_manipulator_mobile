// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/photoTypes.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { z } from 'zod';

/**
 * `PhotoDoc` v1: the photo editor's document (code name `photo`, design
 * `docs/design/PHOTO_EDITOR.md` §4–§5, ADR-0017).
 *
 * THE cross-side contract: the Go sanitizer (`internal/photo`, MM95) mirrors
 * these schemas and both sides are tested against the same fixture documents
 * (`lib/photo/fixtures/docs/*.json`, see `fixtures/README.md`).
 *
 * ADDITIVE-ONLY from v1 on (ADR-0004 rule): new fields are optional, nothing
 * is renamed, an unknown `version` is refused and every object PASSES UNKNOWN
 * KEYS THROUGH, so a newer document keeps its newer fields through an older
 * build. Parsing fills every default, so the canonical form (below) has every
 * known field present: nullable fields as `null`, optional fields absent.
 *
 * Canonical JSON (`canonicalPhotoDoc`): compact, keys sorted by code point at
 * every depth, `-0` written `0`, no HTML escaping. Fixture files are the
 * canonical bytes plus exactly one trailing newline.
 */

export const PHOTO_MAX_DOC_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_LAYERS = 64;
export const PHOTO_MAX_MASK_COMPONENTS = 16;
export const PHOTO_MAX_BRUSH_PX = 1024;
export const PHOTO_MAX_BRUSH_PNG_BYTES = 524_288;
export const PHOTO_MAX_LUT_SIZE = 65;
export const PHOTO_MAX_LUT_BYTES = 1024 * 1024;
export const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function obj<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.object(shape).passthrough() as unknown as z.ZodObject<T>;
}

const num = z.number().finite();
const clampTo = (min: number, max: number, int: boolean) => (v: unknown) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  const x = int ? Math.floor(v + 0.5) : v;
  const c = x < min ? min : x > max ? max : x;
  return c === 0 ? 0 : c;
};
/**
 * A bounded number with its default. Like the Go sanitizer, out-of-range
 * values CLAMP (never refuse) so both sides produce the same canonical bytes
 * (MM95 README "Notes for the UI port"); non-numbers are refused.
 */
const rng = (min: number, max: number, def: number) =>
  z.preprocess(clampTo(min, max, false), num.min(min).max(max)).default(def) as unknown as z.ZodDefault<z.ZodNumber>;
const int = (min: number, max: number, def: number) =>
  z.preprocess(clampTo(min, max, true), num.int().min(min).max(max)).default(def) as unknown as z.ZodDefault<z.ZodNumber>;
const unit = z.preprocess(clampTo(0, 1, false), num.min(0).max(1)) as unknown as z.ZodNumber;
const pct = (def = 0) => rng(-100, 100, def);
const HEX = /^#[0-9A-Fa-f]{6}$/;
const hex = (def: string) => z.string().regex(HEX).transform((v) => v.toLowerCase()).default(def);

export const photoIdSchema = z.string().regex(PHOTO_ID_PATTERN);

// ---------------------------------------------------------------------------
// Adjustment params (design §5.1)
// ---------------------------------------------------------------------------

export const exposureParams = obj({ ev: rng(-5, 5, 0), offset: rng(-0.5, 0.5, 0), gamma: rng(0.1, 10, 1) });
export const brightnessContrastParams = obj({ brightness: pct(), contrast: pct() });
export const toneParams = obj({ highlights: pct(), shadows: pct(), whites: pct(), blacks: pct() });

export const levelsChannelSchema = obj({
  inBlack: rng(0, 1, 0),
  inWhite: rng(0, 1, 1),
  gamma: rng(0.1, 10, 1),
  outBlack: rng(0, 1, 0),
  outWhite: rng(0, 1, 1),
});
export const LEVELS_CHANNELS = ['master', 'r', 'g', 'b'] as const;
export type LevelsChannel = (typeof LEVELS_CHANNELS)[number];
export const levelsParams = obj({
  master: levelsChannelSchema.default({}),
  r: levelsChannelSchema.default({}),
  g: levelsChannelSchema.default({}),
  b: levelsChannelSchema.default({}),
});

export const curvePointSchema = obj({ x: unit, y: unit });
export type CurvePoint = { x: number; y: number };
const identityPoints = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
export const curveSchema = obj({
  points: z
    .array(curvePointSchema)
    .min(2)
    .max(16)
    .refine((p) => p.every((q, i) => i === 0 || q.x > p[i - 1].x), { message: 'curve x must be strictly increasing' })
    .default(identityPoints),
});
export const curvesParams = obj({
  master: curveSchema.default({}),
  r: curveSchema.default({}),
  g: curveSchema.default({}),
  b: curveSchema.default({}),
});

export const whiteBalanceParams = obj({ temperature: pct(), tint: pct() });
export const vibranceSaturationParams = obj({ vibrance: pct(), saturation: pct() });

export const hslAdjustSchema = obj({ hue: rng(-180, 180, 0), saturation: pct(), lightness: pct() });
export const hslRangeSchema = obj({
  id: photoIdSchema,
  name: z.string().max(80).optional(),
  center: rng(0, 360, 0),
  width: rng(10, 120, 30),
  feather: rng(0, 90, 30),
  hue: rng(-180, 180, 0),
  saturation: pct(),
  lightness: pct(),
});
export type HslRange = z.infer<typeof hslRangeSchema>;
export const HSL_RANGE_IDS = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const;
export const defaultHslRanges = (): HslRange[] =>
  HSL_RANGE_IDS.map((id, i) => ({ id, center: i * 60, width: 30, feather: 30, hue: 0, saturation: 0, lightness: 0 }));
export const hslParams = obj({
  master: hslAdjustSchema.default({}),
  ranges: z.array(hslRangeSchema).max(32).default(defaultHslRanges),
});

const rgbShift = obj({ r: pct(), g: pct(), b: pct() });
export const colorBalanceParams = obj({
  shadows: rgbShift.default({}),
  midtones: rgbShift.default({}),
  highlights: rgbShift.default({}),
  preserveLuminosity: z.boolean().default(true),
});

export const blackWhiteTintSchema = obj({ hue: rng(0, 360, 0), saturation: rng(0, 100, 0) });
const bw = (def: number) => rng(-200, 300, def);
export const blackWhiteParams = obj({
  reds: bw(40),
  yellows: bw(60),
  greens: bw(40),
  cyans: bw(60),
  blues: bw(20),
  magentas: bw(80),
  tint: blackWhiteTintSchema.nullable().default(null),
});

const mixRow = (r: number, g: number, b: number) =>
  obj({
    r: rng(-200, 200, r),
    g: rng(-200, 200, g),
    b: rng(-200, 200, b),
    constant: rng(-200, 200, 0),
  });
export const channelMixerParams = obj({
  r: mixRow(100, 0, 0).default({}),
  g: mixRow(0, 100, 0).default({}),
  b: mixRow(0, 0, 100).default({}),
  monochrome: z.boolean().default(false),
});

export const PHOTO_FILTER_WARMING = '#ec8a00';
export const photoFilterParams = obj({
  color: hex(PHOTO_FILTER_WARMING),
  density: rng(0, 100, 25),
  preserveLuminosity: z.boolean().default(true),
});

const toneEnd = obj({ hue: rng(0, 360, 0), saturation: rng(0, 100, 0) });
export const splitToneParams = obj({
  shadows: toneEnd.default({}),
  highlights: toneEnd.default({}),
  balance: pct(),
});

const cubeText = z
  .string()
  .max(PHOTO_MAX_LUT_BYTES)
  .refine(
    (t) => {
      if (t === '') return true;
      const m = /^\s*LUT_3D_SIZE\s+(\d+)\s*$/m.exec(t);
      return !!m && Number(m[1]) >= 2 && Number(m[1]) <= PHOTO_MAX_LUT_SIZE;
    },
    { message: 'lut cube needs LUT_3D_SIZE 2..65' },
  )
  .default('');
export const lutParams = obj({
  cube: cubeText,
  intensity: rng(0, 1, 1),
});

export const emptyParams = obj({});
export const posterizeParams = obj({ levels: int(2, 255, 4) });
export const thresholdParams = obj({ level: rng(0, 1, 0.5) });
export const gammaParams = obj({ gamma: rng(0.1, 10, 1) });

// Additive types: `redEye` is a rung-1 colour op used inside a mask (MM98 UI);
// the rung-4 detail ops (design §5.4) are modelled so documents round-trip and
// are rendered by MM99 (the MM97 reference renderer passes them through).
export const sharpenParams = obj({ amount: rng(0, 500, 100), radius: rng(0.1, 50, 1), threshold: rng(0, 255, 0) });
export const blurParams = obj({ radius: rng(0, 100, 0) });
export const noiseReductionParams = obj({ luminance: rng(0, 100, 0), color: rng(0, 100, 0) });
export const amountParams = obj({ amount: pct() });
export const vignetteParams = obj({
  amount: pct(),
  midpoint: rng(0, 100, 50),
  roundness: pct(),
  feather: rng(0, 100, 50),
  highlights: rng(0, 100, 0),
});
export const grainParams = obj({ amount: rng(0, 100, 0), size: rng(1, 3, 1), roughness: rng(0, 100, 50), seed: int(0, 4294967295, 0) });

// ---------------------------------------------------------------------------
// Masks (design §4, §5.2; rendered by MM98, modelled here so documents round-trip)
// ---------------------------------------------------------------------------

const point = obj({ x: rng(-1, 2, 0), y: rng(-1, 2, 0) });
const mode = z.enum(['add', 'subtract', 'intersect']).default('add');
export const BRUSH_PNG_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]*$/;
export const maskComponentSchema = z.discriminatedUnion('kind', [
  obj({
    kind: z.literal('gradient'),
    mode,
    from: point.default({ x: 0.5, y: 0.3 }),
    to: point.default({ x: 0.5, y: 0.7 }),
    feather: rng(0, 1, 0),
  }),
  obj({
    kind: z.literal('radial'),
    mode,
    center: point.default({ x: 0.5, y: 0.5 }),
    rx: rng(0, 2, 0.3),
    ry: rng(0, 2, 0.3),
    rotate: rng(-180, 180, 0),
    feather: rng(0, 1, 0.5),
  }),
  obj({
    kind: z.literal('brush'),
    mode,
    png: z.string().max(Math.ceil((PHOTO_MAX_BRUSH_PNG_BYTES * 4) / 3) + 64).regex(BRUSH_PNG_PATTERN),
    width: z.number().int().min(1).max(PHOTO_MAX_BRUSH_PX),
    height: z.number().int().min(1).max(PHOTO_MAX_BRUSH_PX),
  }),
  obj({
    kind: z.literal('luminosity'),
    mode,
    lo: rng(0, 1, 0),
    hi: rng(0, 1, 1),
    feather: rng(0, 1, 0.1),
  }),
  obj({
    kind: z.literal('colorRange'),
    mode,
    colors: z.array(obj({ r: int(0, 255, 0), g: int(0, 255, 0), b: int(0, 255, 0) })).max(16).default([]),
    fuzziness: rng(0, 100, 40),
  }),
  obj({
    kind: z.literal('subject'),
    mode,
    maskRef: z.string().regex(/^masks\/[A-Za-z0-9_-]{1,40}\.png$/),
    invert: z.boolean().default(false),
  }),
]);
export type MaskComponent = z.infer<typeof maskComponentSchema>;

export const maskSchema = obj({
  components: z.array(maskComponentSchema).max(PHOTO_MAX_MASK_COMPONENTS).default([]),
  feather: rng(0, 100, 0),
  invert: z.boolean().default(false),
  opacity: unit.default(1),
});
export type Mask = z.infer<typeof maskSchema>;

/**
 * A reference to a named mask in `doc.masks` (MM98 decision D3, additive):
 * several layers can share one mask. Both forms are valid on `layer.mask`.
 */
export const maskRefSchema = obj({ ref: photoIdSchema });
export type MaskRef = { ref: string };
export type LayerMask = Mask | MaskRef;
export const layerMaskSchema = z.union([maskRefSchema, maskSchema]);
export const PHOTO_MAX_NAMED_MASKS = 64;
export const isMaskRef = (m: LayerMask | null | undefined): m is MaskRef =>
  !!m && typeof (m as MaskRef).ref === 'string';

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export const BLEND_MODES = ['normal', 'luminosity', 'color'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Layer type → params schema; the single table every consumer keys off. */
export const LAYER_PARAMS = {
  exposure: exposureParams,
  brightnessContrast: brightnessContrastParams,
  tone: toneParams,
  levels: levelsParams,
  curves: curvesParams,
  whiteBalance: whiteBalanceParams,
  vibranceSaturation: vibranceSaturationParams,
  hsl: hslParams,
  colorBalance: colorBalanceParams,
  blackWhite: blackWhiteParams,
  channelMixer: channelMixerParams,
  photoFilter: photoFilterParams,
  splitTone: splitToneParams,
  lut: lutParams,
  invert: emptyParams,
  posterize: posterizeParams,
  threshold: thresholdParams,
  gamma: gammaParams,
  redEye: emptyParams,
  sharpen: sharpenParams,
  blur: blurParams,
  noiseReduction: noiseReductionParams,
  clarity: amountParams,
  texture: amountParams,
  dehaze: amountParams,
  vignette: vignetteParams,
  grain: grainParams,
} as const;
export type LayerType = keyof typeof LAYER_PARAMS;
export const LAYER_TYPES = Object.keys(LAYER_PARAMS) as LayerType[];

const layerBase = {
  id: photoIdSchema,
  name: z.string().max(80).optional(),
  /** MM99: preset group header the layers panel collapses on; absent when unset. */
  group: z.string().max(80).optional(),
  enabled: z.boolean().default(true),
  opacity: unit.default(1),
  blend: z.enum(BLEND_MODES).default('normal'),
  mask: layerMaskSchema.nullable().default(null),
};

function layerOf(type: LayerType) {
  return obj({ ...layerBase, type: z.literal(type), params: (LAYER_PARAMS[type] as z.ZodTypeAny).default({}) });
}

type ParamsOf<K extends LayerType> = z.infer<(typeof LAYER_PARAMS)[K]>;
type LayerCommon = {
  id: string;
  name?: string;
  group?: string;
  enabled: boolean;
  opacity: number;
  blend: BlendMode;
  mask: LayerMask | null;
};
export type AdjustmentLayer = {
  [K in LayerType]: LayerCommon & { type: K; params: ParamsOf<K> };
}[LayerType];
export type LayerOf<K extends LayerType> = Extract<AdjustmentLayer, { type: K }>;

export const layerSchema = z.discriminatedUnion(
  'type',
  LAYER_TYPES.map(layerOf) as unknown as [ReturnType<typeof layerOf>, ReturnType<typeof layerOf>, ...ReturnType<typeof layerOf>[]],
) as unknown as z.ZodType<AdjustmentLayer, z.ZodTypeDef, unknown>;

// ---------------------------------------------------------------------------
// Geometry (modelled here; applied by MM98)
// ---------------------------------------------------------------------------

const cornerOffset = obj({ x: rng(-1, 1, 0), y: rng(-1, 1, 0) });
export const geometrySchema = obj({
  rotate: rng(-360, 360, 0),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  perspective: obj({ tl: cornerOffset.default({}), tr: cornerOffset.default({}), br: cornerOffset.default({}), bl: cornerOffset.default({}) })
    .nullable()
    .default(null),
  crop: obj({ x: rng(0, 0.999, 0), y: rng(0, 0.999, 0), width: rng(0.001, 1, 1), height: rng(0.001, 1, 1) })
    .transform((c) => ({ ...c, width: Math.min(c.width, 1 - c.x), height: Math.min(c.height, 1 - c.y) }))
    .nullable()
    .default(null),
  fill: z
    .string()
    .regex(/^(transparent|edge|#[0-9A-Fa-f]{6})$/)
    .transform((v) => v.toLowerCase())
    .default('transparent'),
});
export type Geometry = z.infer<typeof geometrySchema>;

export const PHOTO_FORMATS = ['jpg', 'png', 'webp', 'avif', 'tiff'] as const;
export const outputSchema = obj({
  format: z.enum(PHOTO_FORMATS).optional(),
  quality: z.preprocess(clampTo(1, 100, true), num.int().min(1).max(100)).optional() as unknown as z.ZodOptional<z.ZodNumber>,
  metadataMode: z.enum(['keep', 'strip']).optional(),
});

/** A heal's stroke mask (server file) and its healed base (server file or a guest's `local:` marker). */
export const HEAL_MASK_REF = /^masks\/[A-Za-z0-9_-]{1,40}\.png$/;
export const HEAL_BASE_REF = /^(bases\/[A-Za-z0-9_-]{1,64}\.png|local:[A-Za-z0-9_-]{1,64})$/;

export const photoDocSchema = obj({
  version: z.literal(1),
  source: obj({
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    orientation: z.literal(1).default(1),
  }),
  heals: z
    .array(
      obj({
        id: photoIdSchema,
        maskRef: z.string().regex(HEAL_MASK_REF).optional(),
        baseRef: z.string().regex(HEAL_BASE_REF).optional(),
      }).refine((h) => h.maskRef !== undefined || h.baseRef !== undefined, { message: 'heal needs maskRef or baseRef' }),
    )
    .max(256)
    .default([]),
  geometry: geometrySchema.default({}),
  masks: z
    .record(photoIdSchema, maskSchema)
    .refine((r) => Object.keys(r).length <= PHOTO_MAX_NAMED_MASKS, { message: 'too many named masks' })
    .transform((r) => (Object.keys(r).length === 0 ? undefined : r))
    .optional(),
  layers: z.array(layerSchema).max(PHOTO_MAX_LAYERS).default([]),
  output: outputSchema.default({}),
}).superRefine((doc, ctx) => {
  const named = (doc as { masks?: Record<string, unknown> }).masks ?? {};
  (doc.layers as { mask: LayerMask | null }[]).forEach((l, i) => {
    if (isMaskRef(l.mask) && !(l.mask.ref in named)) ctx.addIssue({ code: 'custom', message: `unknown mask ref ${l.mask.ref}`, path: ['layers', i, 'mask'] });
  });
  const dup = (ids: string[], path: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${id}`, path: [path] });
      seen.add(id);
    }
  };
  dup((doc.layers as { id: string }[]).map((l) => l.id), 'layers');
  dup((doc.heals as { id: string }[]).map((h) => h.id), 'heals');
}) as unknown as z.ZodType<PhotoDoc, z.ZodTypeDef, unknown>;

export type PhotoDoc = {
  version: 1;
  source: { width: number; height: number; orientation: 1 };
  heals: { id: string; maskRef?: string; baseRef?: string }[];
  geometry: Geometry;
  /** Named masks layers may reference with `mask: { ref }` (MM98 D3); absent when empty. */
  masks?: Record<string, Mask>;
  layers: AdjustmentLayer[];
  output: z.infer<typeof outputSchema>;
};

// ---------------------------------------------------------------------------
// parse / canonical
// ---------------------------------------------------------------------------

export type ParsePhotoResult =
  | { ok: true; doc: PhotoDoc; warnings: string[] }
  | { ok: false; error: string };

const KNOWN_TOP = new Set(['version', 'source', 'heals', 'geometry', 'masks', 'layers', 'output']);

/** Parse an unknown value (or JSON text). Never throws. Unknown keys survive. */
export function parsePhotoDoc(input: unknown): ParsePhotoResult {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > PHOTO_MAX_DOC_BYTES) return { ok: false, error: 'document too large' };
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: 'invalid JSON' };
    }
  }
  const parsed = photoDocSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
    return { ok: false, error: `${first?.message ?? 'invalid document'}${where}` };
  }
  const warnings = Object.keys(parsed.data)
    .filter((k) => !KNOWN_TOP.has(k))
    .map((k) => `unknown key kept: ${k}`);
  return { ok: true, doc: parsed.data, warnings };
}

function cmpCodePoints(a: string, b: string): number {
  const ca = Array.from(a, (c) => c.codePointAt(0) as number);
  const cb = Array.from(b, (c) => c.codePointAt(0) as number);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i += 1) if (ca[i] !== cb[i]) return ca[i] - cb[i];
  return ca.length - cb.length;
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort(cmpCodePoints)) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortDeep(x);
    }
    return out;
  }
  if (typeof v === 'number' && Object.is(v, -0)) return 0;
  return v;
}

/**
 * Canonical JSON text, byte-identical to Go's `photo.Sanitize` output for the
 * same input (without the file's trailing newline).
 */
export function canonicalPhotoDoc(doc: PhotoDoc): string {
  return JSON.stringify(sortDeep(doc));
}

/** A minimal valid document for a freshly opened photo. */
export function newPhotoDoc(width: number, height: number): PhotoDoc {
  const r = parsePhotoDoc({ version: 1, source: { width, height, orientation: 1 } });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}
