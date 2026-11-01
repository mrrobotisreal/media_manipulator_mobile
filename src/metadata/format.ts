// Ported from media-manipulator-ui lib/metadata/format.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * Value formatting for the inspector table. Pure and locale-parameterised: the
 * caller passes the BCP-47 locale. Returns plain strings (plus structured
 * variants for chips / nested objects) so React stays out of this module.
 */
import { binaryBytes, type MetadataEntry, type MetadataValue } from './types';

export type FormattedValue =
  | { kind: 'text'; text: string; title?: string }
  | { kind: 'chips'; items: string[]; more: number }
  | { kind: 'object'; value: { [key: string]: MetadataValue } }
  | { kind: 'binary'; text: string; bytes: number | undefined };

export const MAX_CHIPS = 12;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const EXIF_DATE_RE =
  /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * `YYYY:MM:DD HH:MM:SS[+hh:mm]` -> localized string. Zone-less dates are shown
 * as wall-clock time without any timezone shift. Returns undefined when the
 * input is not an EXIF-style date (or is the all-zero placeholder).
 */
export function formatExifDate(value: string, locale?: string): string | undefined {
  const m = EXIF_DATE_RE.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, zone] = m;
  if (y === '0000' || mo === '00' || d === '00') return undefined;
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'medium' };
  try {
    if (zone) {
      const z =
        zone === 'Z' ? 'Z' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
      const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z}`);
      if (Number.isNaN(date.getTime())) return undefined;
      const offset = z === 'Z' ? 'UTC' : `UTC${z}`;
      // Render in the file's own offset by formatting as UTC after applying it.
      const shifted = z === 'Z' ? date : new Date(date.getTime() + offsetMinutes(z) * 60000);
      return `${new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(shifted)} (${offset})`;
    }
    const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
    if (Number.isNaN(date.getTime())) return undefined;
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(date);
  } catch {
    return undefined;
  }
}

function offsetMinutes(z: string): number {
  const sign = z.startsWith('-') ? -1 : 1;
  const [hh, mm] = z.slice(1).split(':');
  return sign * (Number(hh) * 60 + Number(mm));
}

/** Coordinate as degrees/minutes/seconds, e.g. `37°46′29.9″ N`. */
export function toDMS(value: number, axis: 'lat' | 'lon'): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${deg}°${min}′${sec.toFixed(1)}″ ${hemi}`;
}

/** `37.774972, -122.419417` plus DMS. */
export function formatCoordinates(lat: number, lon: number): { decimal: string; dms: string } {
  return {
    decimal: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
    dms: `${toDMS(lat, 'lat')}, ${toDMS(lon, 'lon')}`,
  };
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Coordinates from an entry list: `Composite:GPSLatitude/Longitude` raw decimals,
 * else `GPS:GPSLatitude/Longitude` rawValue (signed decimals from the `-n` pass).
 */
export function extractCoordinates(
  entries: readonly Pick<MetadataEntry, 'id' | 'value' | 'rawValue'>[],
): { lat: number; lon: number } | undefined {
  const get = (id: string) => {
    const e = entries.find((x) => x.id === id);
    return e ? (num(e.rawValue) ?? num(e.value)) : undefined;
  };
  for (const g of ['Composite', 'GPS']) {
    const lat = get(`${g}:GPSLatitude`);
    const lon = get(`${g}:GPSLongitude`);
    if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      return { lat, lon };
  }
  return undefined;
}

function scalarText(v: MetadataValue, locale?: string): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number')
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)));
  if (typeof v === 'string') return formatExifDate(v, locale) ?? v;
  return JSON.stringify(v);
}

const isScalar = (v: MetadataValue): v is string | number | boolean | null =>
  v === null || typeof v !== 'object';

/** `1/250` style string, or a number turned into one for short exposures. */
function exposureText(entry: MetadataEntry): string | undefined {
  const raw = num(entry.rawValue) ?? num(entry.value);
  if (typeof entry.value === 'string' && /^\d+\/\d+$/.test(entry.value)) return `${entry.value} s`;
  if (raw === undefined) return undefined;
  if (raw >= 1) return `${Number(raw.toFixed(2))} s`;
  if (raw > 0) return `1/${Math.round(1 / raw)} s`;
  return undefined;
}

/** Formats an entry's value for display. Never throws. */
export function formatValue(entry: MetadataEntry, locale?: string): FormattedValue {
  if (entry.binary) {
    const bytes = binaryBytes(entry);
    return {
      kind: 'binary',
      bytes,
      text: bytes === undefined ? 'Binary' : `Binary · ${formatBytes(bytes)}`,
    };
  }
  const { value, tag } = entry;

  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      const items = value.slice(0, MAX_CHIPS).map((v) => scalarText(v, locale));
      return { kind: 'chips', items, more: Math.max(0, value.length - MAX_CHIPS) };
    }
    return { kind: 'object', value: { items: value } };
  }
  if (value !== null && typeof value === 'object') return { kind: 'object', value };

  if (tag === 'ExposureTime' || tag === 'ShutterSpeed' || tag === 'ShutterSpeedValue') {
    const t = exposureText(entry);
    if (t) return { kind: 'text', text: t };
  }
  if (tag === 'FNumber' || tag === 'Aperture' || tag === 'ApertureValue') {
    const n = num(value) ?? num(entry.rawValue);
    if (n !== undefined) return { kind: 'text', text: `f/${Number(n.toFixed(1))}` };
  }
  if (tag === 'FocalLength' || tag === 'FocalLengthIn35mmFormat') {
    const n = typeof value === 'string' ? /^([\d.]+)\s*mm/.exec(value)?.[1] : num(value);
    if (n !== undefined) return { kind: 'text', text: `${Number(n)} mm` };
  }
  if (tag === 'GPSLatitude' || tag === 'GPSLongitude') {
    const n = num(entry.rawValue);
    if (n !== undefined) {
      const c = toDMS(n, tag === 'GPSLatitude' ? 'lat' : 'lon');
      return { kind: 'text', text: `${n.toFixed(6)} (${c})` };
    }
  }
  if (tag === 'duration' && entry.group === 'Format') {
    const s = typeof value === 'string' ? Number.parseFloat(value) : num(value);
    if (s !== undefined && !Number.isNaN(s))
      return { kind: 'text', text: formatDuration(s), title: `${s} s` };
  }
  if (tag === 'Duration' && typeof value === 'number') {
    return { kind: 'text', text: formatDuration(value), title: `${value} s` };
  }
  if (tag === 'size' && entry.group === 'Format') {
    const s = typeof value === 'string' ? Number.parseInt(value, 10) : num(value);
    if (s !== undefined && !Number.isNaN(s))
      return { kind: 'text', text: formatBytes(s), title: `${s} bytes` };
  }

  if (typeof value === 'string') {
    const d = formatExifDate(value, locale);
    if (d) return { kind: 'text', text: d, title: value };
    return { kind: 'text', text: value };
  }
  return { kind: 'text', text: scalarText(value, locale) };
}

/** Plain-text rendition used by search and copy. */
export function formatValueText(entry: MetadataEntry, locale?: string): string {
  const f = formatValue(entry, locale);
  switch (f.kind) {
    case 'text':
    case 'binary':
      return f.text;
    case 'chips':
      return f.items.join(', ') + (f.more ? ` +${f.more}` : '');
    case 'object':
      return JSON.stringify(f.value);
  }
}
