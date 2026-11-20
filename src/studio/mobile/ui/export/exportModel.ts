/**
 * The Darkroom export sheet's pure model (ticket MA58 decision 2): a port of the web's
 * `lib/studio/studioOutputs.ts` + `lib/studio/exportOptions.ts` rules, driven ONLY by the API's
 * `GET /studio/export-options` answer (the app keeps no copy of the output table). No React, no I/O.
 *
 * The SERVER enforces the plan (403 `format_not_in_plan`, 403 `output_height_limited`, 429 export
 * allowance). The sheet only marks locked options (greyed, the neutral "Not on your plan" line,
 * ADR MA-0008), never hides them.
 */
import type {
  StudioExportOptions,
  StudioExportRequest,
  StudioOutputPreset,
  StudioOutputTable,
} from '@/api/schemas/studio';

export type Quality = 'low' | 'medium' | 'high';
export type Loudness = 'none' | 'streaming' | 'podcast' | 'broadcast';
/** `sidecar` is not offered on the phone: the web writes the SRT/VTT files in the browser. */
export type CaptionsMode = 'none' | 'burn_in' | 'embedded';

export const QUALITIES: readonly Quality[] = ['high', 'medium', 'low'];
export const LOUDNESS: readonly Loudness[] = ['none', 'streaming', 'podcast', 'broadcast'];
/** 0 = the project's canvas height. Display order (the web's `RESOLUTION_RUNGS`). */
export const RESOLUTION_RUNGS = [0, 2160, 1440, 1080, 720] as const;
export const EMBEDDED_SUBS_TOKEN = 'subs_embedded';
export const ADVANCED_OPTION = 'advanced';

export interface OutputChoice {
  container: string;
  videoCodec: string;
  audioCodec: string;
  /** kbps; 0 = the codec's default / none. */
  audioBitrate: number;
  /** 1 | 2. */
  audioChannels: number;
}

export interface ExportChoices {
  fileName: string;
  quality: Quality;
  loudness: Loudness;
  outputPreset: string;
  /** `advanced` = the custom container/codec pickers (Premium and Pro). */
  mode: 'preset' | 'advanced';
  output: OutputChoice;
  resolution: number;
  captionsMode: CaptionsMode;
}

/** A lock: the option (token or `advanced`) the caller lacks and the lowest plan that has it. */
export interface OptionLock {
  option: string;
  required: string | null;
}

/** What the sheet knows about the caller. */
export interface OutputAccess {
  required: Record<string, string>;
  formats: readonly string[];
  advanced: boolean;
  tier: string;
}

export function accessOf(o: StudioExportOptions): OutputAccess {
  return {
    required: o.required,
    formats: o.caller.formats,
    advanced: o.caller.advanced,
    tier: o.caller.tier,
  };
}

const container = (t: StudioOutputTable, key: string) => t.containers.find((c) => c.key === key);
const codec = (t: StudioOutputTable, key: string) => t.codecs.find((c) => c.key === key);

/** The gated tokens of a choice: container, video codec (unless none), audio codec (unless it is the container). */
export function choiceTokens(c: Pick<OutputChoice, 'container' | 'videoCodec' | 'audioCodec'>): string[] {
  const out = [c.container];
  if (c.videoCodec && c.videoCodec !== 'none') out.push(c.videoCodec);
  if (c.audioCodec && c.audioCodec !== c.container) out.push(c.audioCodec);
  return out;
}

/** The first token the caller lacks (null = allowed; the operator has everything). */
export function lockFor(tokens: string[], access: OutputAccess, advanced = false): OptionLock | null {
  if (access.tier === 'operator') return null;
  const have = new Set(access.formats);
  const missing = tokens.find((tok) => !have.has(tok));
  if (missing) return { option: missing, required: access.required[missing] ?? null };
  if (advanced && !access.advanced)
    return { option: ADVANCED_OPTION, required: access.required[ADVANCED_OPTION] ?? null };
  return null;
}

export function presetChoice(p: StudioOutputPreset, t: StudioOutputTable): OutputChoice {
  return {
    container: p.container,
    videoCodec: p.videoCodec,
    audioCodec: p.audioCodec,
    audioBitrate: codec(t, p.audioCodec)?.defaultBitrate ?? 0,
    audioChannels: t.defaultChannels,
  };
}

export function presetFor(
  c: Pick<OutputChoice, 'container' | 'videoCodec' | 'audioCodec'>,
  t: StudioOutputTable,
): StudioOutputPreset | undefined {
  return t.presets.find(
    (p) => p.container === c.container && p.videoCodec === c.videoCodec && p.audioCodec === c.audioCodec,
  );
}

export function isAudioOnlyContainer(key: string, t: StudioOutputTable): boolean {
  return Boolean(container(t, key)?.audioOnly);
}

/** The file extension (no dot) and MIME of a container. */
export function containerFile(key: string, t: StudioOutputTable): { ext: string; mime: string } {
  const c = container(t, key);
  return { ext: (c?.ext ?? '.mp4').replace(/^\./, ''), mime: c?.mime ?? 'video/mp4' };
}

/** The audio codecs a container offers with a video codec (the API's StudioAudioCodecsFor). */
export function audioCodecsFor(containerKey: string, videoCodec: string, t: StudioOutputTable): string[] {
  const c = container(t, containerKey);
  if (!c) return [];
  const narrow = codec(t, videoCodec)?.audioCodecs;
  if (!narrow?.length) return c.audioCodecs;
  return narrow.filter((a) => c.audioCodecs.includes(a));
}

/** True when the choice needs the Advanced picker (the API's StudioOutput.Advanced). */
export function needsAdvanced(c: OutputChoice, t: StudioOutputTable): boolean {
  if (!presetFor(c, t)) return true;
  const def = codec(t, c.audioCodec)?.defaultBitrate ?? 0;
  const bitrate = c.audioBitrate || def;
  return bitrate !== def || (c.audioChannels || t.defaultChannels) !== t.defaultChannels;
}

/** The table's warnings for a combination (closed list, translated by the web shard). */
export function outputWarnings(
  c: Pick<OutputChoice, 'container' | 'videoCodec' | 'audioCodec'>,
  t: StudioOutputTable,
): string[] {
  return t.warnings
    .filter(
      (w) =>
        (!w.container || w.container === c.container) &&
        (!w.videoCodec || w.videoCodec === c.videoCodec) &&
        (!w.audioCodec || w.audioCodec === c.audioCodec),
    )
    .map((w) => w.warning);
}

/** The derived label (history, analytics): the legacy name for its four combinations, else `<c>_<v>_<a>`. */
export function outputLabel(
  c: Pick<OutputChoice, 'container' | 'videoCodec' | 'audioCodec'>,
  t: StudioOutputTable,
): string {
  const p = presetFor(c, t);
  if (p) {
    const legacy = Object.entries(t.legacyFormats).find(([, key]) => key === p.key);
    if (legacy) return legacy[0];
  }
  return `${c.container}_${c.videoCodec}_${c.audioCodec}`;
}

export interface PresetRow {
  preset: StudioOutputPreset;
  choice: OutputChoice;
  audioOnly: boolean;
  lock: OptionLock | null;
}

/** Every preset in table order, each with its lock (locked rows stay listed). */
export function presetRows(t: StudioOutputTable, access: OutputAccess): PresetRow[] {
  return t.presets.map((p) => {
    const choice = presetChoice(p, t);
    return {
      preset: p,
      choice,
      audioOnly: isAudioOnlyContainer(p.container, t),
      lock: lockFor(choiceTokens(choice), access),
    };
  });
}

export interface PickerOption {
  value: string;
  lock: OptionLock | null;
}

/** Containers for the Advanced picker, each with its lock. */
export function containerOptions(t: StudioOutputTable, access: OutputAccess): PickerOption[] {
  return t.containers.map((c) => ({ value: c.key, lock: lockFor([c.key], access) }));
}

/** The video (or audio) codecs the chosen container carries, each with its lock. */
export function codecOptions(
  kind: 'video' | 'audio',
  out: OutputChoice,
  t: StudioOutputTable,
  access: OutputAccess,
): PickerOption[] {
  const c = container(t, out.container);
  if (!c) return [];
  if (kind === 'video' && c.audioOnly) return [{ value: 'none', lock: null }];
  const values = kind === 'video' ? c.videoCodecs : audioCodecsFor(c.key, out.videoCodec, t);
  // The container's own codec (mp3 in .mp3) is not a separate token.
  return values.map((value) => ({
    value,
    lock: lockFor(value === c.key || value === 'none' ? [] : [value], access),
  }));
}

export function bitrateOptions(audioCodec: string, t: StudioOutputTable): number[] {
  return codec(t, audioCodec)?.bitrates ?? [];
}

/** Re-fit a choice after its container or video codec changed (the web's `fitChoice`). */
export function fitChoice(c: OutputChoice, t: StudioOutputTable): OutputChoice {
  const k = container(t, c.container) ?? t.containers[0]!;
  const videoCodec = k.videoCodecs.includes(c.videoCodec) ? c.videoCodec : k.videoCodecs[0]!;
  const audio = audioCodecsFor(k.key, videoCodec, t);
  const audioCodec = audio.includes(c.audioCodec) ? c.audioCodec : (audio[0] ?? '');
  const rates = bitrateOptions(audioCodec, t);
  const def = codec(t, audioCodec)?.defaultBitrate ?? 0;
  const audioBitrate = rates.length === 0 ? 0 : rates.includes(c.audioBitrate) ? c.audioBitrate : def;
  const audioChannels = t.channels.includes(c.audioChannels) ? c.audioChannels : t.defaultChannels;
  return { container: k.key, videoCodec, audioCodec, audioBitrate, audioChannels };
}

/** The output a set of choices renders. */
export function choiceOutput(
  c: Pick<ExportChoices, 'mode' | 'outputPreset' | 'output'>,
  t: StudioOutputTable,
): OutputChoice {
  if (c.mode === 'advanced') return c.output;
  const p = t.presets.find((x) => x.key === c.outputPreset) ?? t.presets[0]!;
  return presetChoice(p, t);
}

/** The lock on the whole choice (what Start would be refused for), or null. */
export function choiceLock(c: ExportChoices, t: StudioOutputTable, access: OutputAccess): OptionLock | null {
  const out = choiceOutput(c, t);
  const tokens = choiceTokens(out);
  if (c.captionsMode === 'embedded' && !isAudioOnlyContainer(out.container, t))
    tokens.push(EMBEDDED_SUBS_TOKEN);
  return lockFor(tokens, access, c.mode === 'advanced' && needsAdvanced(out, t));
}

export interface ResolutionOption {
  value: number;
  height: number;
  /** Above the caller's `maxOutputHeight` (known and > 0): locked, never hidden. */
  overCap: boolean;
}

export function resolutionOptions(canvasHeight: number, maxOutputHeight?: number): ResolutionOption[] {
  const cap = maxOutputHeight && maxOutputHeight > 0 ? maxOutputHeight : undefined;
  return RESOLUTION_RUNGS.map((value) => {
    const height = value === 0 ? canvasHeight : value;
    return { value, height, overCap: cap !== undefined && height > cap };
  });
}

/** Closed-vocabulary analytics label for a rung. */
export function resolutionLabel(resolution: number): string {
  return resolution > 0 ? `${resolution}p` : 'canvas';
}

/** The default choices: the first preset the caller may use, the canvas height, captions burned in when there are any. */
export function defaultChoices(
  t: StudioOutputTable,
  access: OutputAccess,
  fileName: string,
  hasCaptions: boolean,
): ExportChoices {
  const first = presetRows(t, access).find((r) => !r.lock && !r.audioOnly) ?? presetRows(t, access)[0]!;
  return {
    fileName,
    quality: 'high',
    loudness: 'none',
    outputPreset: first.preset.key,
    mode: 'preset',
    output: first.choice,
    resolution: 0,
    captionsMode: hasCaptions ? 'burn_in' : 'none',
  };
}

/**
 * The wire request (the web's `buildExportRequest` with export depth): a preset sends
 * `outputPreset` alone; Advanced the explicit parts, with bitrate/channels only when they differ
 * from the defaults. Audio-only outputs drop resolution and captions. `format` is never sent.
 */
export function buildExportRequest(c: ExportChoices, t: StudioOutputTable): StudioExportRequest {
  const out = choiceOutput(c, t);
  const audio = isAudioOnlyContainer(out.container, t);
  const name = c.fileName.trim();
  const req: StudioExportRequest = {
    ...(name ? { fileName: name.slice(0, 120) } : {}),
    preset: c.quality,
    loudness: c.loudness === 'none' ? '' : c.loudness,
    resolution: audio ? 0 : c.resolution,
    captionsMode: audio ? 'none' : c.captionsMode,
  };
  const preset = presetFor(out, t);
  if (preset && !needsAdvanced(out, t)) return { ...req, outputPreset: preset.key };
  const def = codec(t, out.audioCodec)?.defaultBitrate;
  return {
    ...req,
    container: out.container,
    videoCodec: out.videoCodec,
    audioCodec: out.audioCodec,
    ...(out.audioBitrate && out.audioBitrate !== def ? { audioBitrate: out.audioBitrate } : {}),
    ...(out.audioChannels && out.audioChannels !== t.defaultChannels
      ? { audioChannels: out.audioChannels }
      : {}),
  };
}

/** Container / codec display names (the web's CODEC_NAMES; never translated). */
export const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'H.265',
  vp9: 'VP9',
  av1: 'AV1',
  prores: 'ProRes 422',
  aac: 'AAC',
  pcm_s16le: 'PCM 16-bit',
  pcm_s24le: 'PCM 24-bit',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  subs_embedded: 'Embedded captions',
};

export function tokenName(token: string): string {
  return CODEC_NAMES[token] ?? token.toUpperCase();
}

/** "MOV · H.265 · AAC 192k" for an exports row (the web's `outputHumanLabel`). */
export function outputHumanLabel(c: {
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  audioBitrate?: number;
  audioChannels?: number;
}): string {
  const parts = [c.container.toUpperCase()];
  if (c.videoCodec && c.videoCodec !== 'none') parts.push(tokenName(c.videoCodec));
  if (c.audioCodec && c.audioCodec !== c.container) {
    const name = tokenName(c.audioCodec);
    parts.push(c.audioBitrate ? `${name} ${c.audioBitrate}k` : name);
  }
  if (c.audioChannels === 1) parts.push('mono');
  return parts.join(' · ');
}

// --- Analytics (studio_export_*; catalog batch "MA58 projects") ----------------------------

/** The `studio_export_*` props of a render (enums only; never the file name). */
export interface StudioExportProps {
  preset: string;
  format: string;
  container: string;
  videoCodec: string;
  audioCodec: string;
  audioBitrate: number;
  audioChannels: number;
  mode: 'preset' | 'advanced';
  resolution: string;
  captionsMode: string;
  captionAnimation: string;
  host: 'mm';
}

export function exportProps(
  c: ExportChoices,
  t: StudioOutputTable,
  captionAnimation: string | undefined,
): StudioExportProps {
  const out = choiceOutput(c, t);
  const audio = isAudioOnlyContainer(out.container, t);
  return {
    preset: c.quality,
    format: outputLabel(out, t),
    container: out.container,
    videoCodec: out.videoCodec,
    audioCodec: out.audioCodec,
    audioBitrate: out.audioBitrate,
    audioChannels: out.audioChannels,
    mode: needsAdvanced(out, t) ? 'advanced' : 'preset',
    resolution: audio ? 'audio' : resolutionLabel(c.resolution),
    captionsMode: audio ? 'none' : c.captionsMode,
    captionAnimation: audio || c.captionsMode !== 'burn_in' ? 'none' : (captionAnimation ?? 'none'),
    host: 'mm',
  };
}

/** The props of an Export again, from the stored row (the web's `rerenderExportProps`). */
export function againProps(
  row: {
    preset?: string;
    format: string;
    container: string;
    videoCodec: string;
    audioCodec: string;
    audioBitrate?: number;
    audioChannels?: number;
    resolution: number;
    captionsMode: string;
  },
  t: StudioOutputTable | undefined,
): StudioExportProps {
  const out: OutputChoice = {
    container: row.container,
    videoCodec: row.videoCodec,
    audioCodec: row.audioCodec,
    audioBitrate: row.audioBitrate ?? 0,
    audioChannels: row.audioChannels ?? t?.defaultChannels ?? 2,
  };
  const audio = t ? isAudioOnlyContainer(out.container, t) : false;
  return {
    preset: row.preset || 'high',
    format: row.format,
    container: out.container,
    videoCodec: out.videoCodec,
    audioCodec: out.audioCodec,
    audioBitrate: out.audioBitrate,
    audioChannels: out.audioChannels,
    mode: t && needsAdvanced(out, t) ? 'advanced' : 'preset',
    resolution: audio ? 'audio' : resolutionLabel(row.resolution),
    captionsMode: audio ? 'none' : row.captionsMode || 'none',
    captionAnimation: 'none',
    host: 'mm',
  };
}

/** Render seconds / timeline seconds (the web's `ratioBucket`). */
export function durationRatioBucket(renderMs: number, timelineSeconds: number): string | undefined {
  if (!Number.isFinite(renderMs) || renderMs < 0) return undefined;
  if (!Number.isFinite(timelineSeconds) || timelineSeconds <= 0) return undefined;
  const ratio = renderMs / 1000 / timelineSeconds;
  if (ratio < 0.25) return '<0.25x';
  if (ratio < 0.5) return '0.25-0.5x';
  if (ratio < 1) return '0.5-1x';
  if (ratio < 2) return '1-2x';
  if (ratio < 4) return '2-4x';
  return '4x+';
}
