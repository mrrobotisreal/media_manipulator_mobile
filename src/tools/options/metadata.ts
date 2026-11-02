import type { ToolOptions } from '../types';
import type { MetadataDocument } from '@/metadata/types';
import { extractCoordinates } from '@/metadata/format';

/**
 * Option builders for the metadata tools (MA21 decision 6). Pure.
 *
 * Image strip mirrors the web `handleStripEverything` (components/embedded-tool-panel.tsx ~L699):
 * the output keeps the input format when it is one of jpg|png|webp|gif|avif (`jpeg` -> jpg), else jpg.
 * `pruneEmptyValues` is a port of components/image-conversion-form.tsx ~L52.
 */

export type MetadataMediaKind = 'image' | 'video' | 'audio';
export type LocationMode = 'keep' | 'remove' | 'replace' | 'round';

export interface StripMetadataForm {
  /** Lower-case, no dot; set by the tool screen from the picked file. */
  sourceExtension: string;
  mediaKind: MetadataMediaKind;
  [key: string]: unknown;
}

export interface EditMetadataForm extends StripMetadataForm {
  title: string;
  author: string;
  description: string;
  copyright: string;
  comment: string;
  keywords: string;
  location: LocationMode;
  latitude: string;
  longitude: string;
  altitude: string;
  precisionDecimals: number;
  removeDirection: boolean;
  removeTimestamp: boolean;
  removeAltitude: boolean;
  removeDestination: boolean;
}

export const METADATA_FIELD_MAX = 1000;
export const DEFAULT_PRECISION_DECIMALS = 3;

const ext = (form: Pick<StripMetadataForm, 'sourceExtension'>) =>
  (form.sourceExtension ?? '').trim().toLowerCase().replace(/^\./, '');

/** Image output format (strip and edit): the input format when the API can write it, else jpg. */
export function imageStripFormat(sourceExtension: string): string {
  const e = ext({ sourceExtension });
  if (e === 'jpeg') return 'jpg';
  return ['jpg', 'png', 'webp', 'gif', 'avif'].includes(e) ? e : 'jpg';
}

export function videoStripFormat(sourceExtension: string): string {
  const e = ext({ sourceExtension });
  return ['mp4', 'mov', 'webm', 'mkv'].includes(e) ? e : 'mp4';
}

export function audioStripFormat(sourceExtension: string): string {
  const e = ext({ sourceExtension });
  if (e === 'm4a' || e === 'aac') return 'aac';
  return ['mp3', 'wav', 'flac', 'ogg', 'opus'].includes(e) ? e : 'mp3';
}

export const STRIP_DEFAULTS: StripMetadataForm = {
  sourceExtension: '',
  mediaKind: 'image',
  format: 'jpg',
  quality: 85,
  filter: 'none',
  metadataMode: 'strip',
};

export function buildStripOptions(form: StripMetadataForm): ToolOptions {
  switch (form.mediaKind) {
    case 'video':
      return {
        format: videoStripFormat(form.sourceExtension),
        quality: 'high',
        speed: 1,
        preserveAspectRatio: true,
        metadataMode: 'strip',
      };
    case 'audio':
      return {
        bitrate: '320',
        sampleRate: '44100',
        channels: 'stereo',
        speed: 1,
        volume: 1,
        format: audioStripFormat(form.sourceExtension),
        metadataMode: 'strip',
      };
    default:
      return {
        format: imageStripFormat(form.sourceExtension),
        quality: 85,
        filter: 'none',
        metadataMode: 'strip',
      };
  }
}

export const EDIT_DEFAULTS: EditMetadataForm = {
  ...STRIP_DEFAULTS,
  metadataMode: 'custom',
  title: '',
  author: '',
  description: '',
  copyright: '',
  comment: '',
  keywords: '',
  location: 'keep',
  latitude: '',
  longitude: '',
  altitude: '',
  precisionDecimals: DEFAULT_PRECISION_DECIMALS,
  removeDirection: false,
  removeTimestamp: false,
  removeAltitude: false,
  removeDestination: false,
};

/** Port of the web `pruneEmptyValues`: drops '', null, undefined and empty containers. */
export function pruneEmptyValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(pruneEmptyValues).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, pruneEmptyValues(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  if (value === '' || value === null || value === undefined) return undefined;
  return value;
}

const num = (s: string): number | undefined => {
  const trimmed = (s ?? '').trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Valid latitude/longitude for Replace/Round, else undefined. */
export function parseCoordinates(
  form: Pick<EditMetadataForm, 'latitude' | 'longitude'>,
): { lat: number; lon: number } | undefined {
  const lat = num(form.latitude);
  const lon = num(form.longitude);
  if (lat === undefined || lon === undefined) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

/** True when the form can be submitted (Replace/Round need valid coordinates). */
export function editFormValid(form: EditMetadataForm): boolean {
  if (form.location === 'replace' || form.location === 'round') {
    if (!parseCoordinates(form)) return false;
    const alt = (form.altitude ?? '').trim();
    if (alt !== '' && num(alt) === undefined) return false;
  }
  return true;
}

export function buildEditOptions(form: EditMetadataForm): ToolOptions {
  const text = (s: string) => (s ?? '').trim().slice(0, METADATA_FIELD_MAX);
  const metadata = pruneEmptyValues({
    title: text(form.title),
    author: text(form.author),
    description: text(form.description),
    copyright: text(form.copyright),
    comment: text(form.comment),
    keywords: text(form.keywords),
  });
  const replacing = form.location === 'replace' || form.location === 'round';
  const coords = replacing ? parseCoordinates(form) : undefined;
  const decimals = Math.min(8, Math.max(0, Math.round(form.precisionDecimals)));
  const gps = pruneEmptyValues({
    removeLocationData: form.location === 'remove' ? true : undefined,
    replaceLocationData: replacing && coords ? true : undefined,
    latitude: coords?.lat,
    longitude: coords?.lon,
    altitude: replacing && coords ? num(form.altitude) : undefined,
    roundLocationPrecision: form.location === 'round' && coords ? true : undefined,
    precisionDecimals: form.location === 'round' && coords ? decimals : undefined,
    removeCaptureDirection: form.removeDirection ? true : undefined,
    removeGpsTimestamp: form.removeTimestamp ? true : undefined,
    removeAltitude: form.removeAltitude ? true : undefined,
    removeDestinationFields: form.removeDestination ? true : undefined,
  });
  const options: ToolOptions = {
    format: imageStripFormat(form.sourceExtension),
    quality: 85,
    filter: 'none',
    metadataMode: 'custom',
  };
  if (metadata) options.metadata = metadata;
  if (gps) options.gpsOptions = gps;
  return options;
}

const stringValue = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ');
  return undefined;
};

/** Text-field and coordinate prefill from an inspected document (decision 6). */
export function prefillFromDocument(doc: MetadataDocument): Partial<EditMetadataForm> {
  const find = (pred: (e: MetadataDocument['entries'][number]) => boolean): string | undefined => {
    for (const e of doc.entries) if (pred(e)) return stringValue(e.value);
    return undefined;
  };
  const out: Partial<EditMetadataForm> = {};
  const title = find((e) => e.tag === 'Title' && e.group.startsWith('XMP'));
  const author = find((e) => e.tag === 'Artist');
  const description = find((e) => e.tag === 'ImageDescription');
  const copyright = find((e) => e.tag === 'Copyright');
  const comment = find((e) => e.tag === 'UserComment');
  const keywords = find((e) => e.tag === 'Keywords' && e.group.startsWith('IPTC'));
  const cap = (s: string | undefined) => (s ? s.slice(0, METADATA_FIELD_MAX) : undefined);
  if (cap(title)) out.title = cap(title)!;
  if (cap(author)) out.author = cap(author)!;
  if (cap(description)) out.description = cap(description)!;
  if (cap(copyright)) out.copyright = cap(copyright)!;
  if (cap(comment)) out.comment = cap(comment)!;
  if (cap(keywords)) out.keywords = cap(keywords)!;
  const c = extractCoordinates(doc.entries);
  if (c) {
    out.latitude = String(Number(c.lat.toFixed(6)));
    out.longitude = String(Number(c.lon.toFixed(6)));
  }
  return out;
}
