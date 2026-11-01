// Ported from media-manipulator-ui lib/metadata/humanize.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * Human-readable tag names. Heuristic by design: the raw exiftool name is always
 * shown beside the result, so a small override map plus a camelCase splitter is
 * enough. Pure: no React, no DOM.
 */

/** Names the splitter gets wrong or that deserve a fixed label. */
const OVERRIDES: Record<string, string> = {
  ISO: 'ISO',
  FNumber: 'F-number',
  MIMEType: 'MIME type',
  ICCProfile: 'ICC profile',
  GPSPosition: 'GPS position',
  XResolution: 'X resolution',
  YResolution: 'Y resolution',
  ImageSize: 'Image size',
  DateTimeOriginal: 'Date/time original',
  CreateDate: 'Create date',
  ModifyDate: 'Modify date',
  ExifToolVersion: 'ExifTool version',
  ThumbnailImage: 'Thumbnail image',
  JpgFromRaw: 'JPEG from RAW',
  SubSecTimeOriginal: 'Sub-second time original',
};

const WORD_RE = /[A-Z]+(?![a-z])|[A-Z][a-z]+|[0-9]+|[a-z]+/g;

/** Vendor display names for reverse-DNS keys (`com.apple.quicktime.make`). */
const VENDOR_NAMES: Record<string, string> = {
  apple: 'Apple',
  android: 'Android',
  google: 'Google',
  adobe: 'Adobe',
  samsung: 'Samsung',
};

const ACRONYM_RE = /^[A-Z0-9]{2,}$/;

function splitWords(raw: string): string[] {
  return (raw.match(WORD_RE) ?? [raw]).filter(Boolean);
}

function sentenceCase(words: string[]): string {
  const out = words.map((w, i) => {
    if (ACRONYM_RE.test(w) || /^[A-Z]$/.test(w)) return w; // GPS, ISO, X
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
  });
  return out
    .join(' ')
    .replace(/\bDate time\b/i, (m) => (m.startsWith('D') ? 'Date/time' : 'date/time'));
}

/**
 * `DateTimeOriginal` -> "Date/time original", `GPSLatitude` -> "GPS latitude",
 * `XResolution` -> "X resolution", `major_brand` -> "Major brand",
 * `com.apple.quicktime.make` -> "Make (Apple QuickTime)",
 * `0:Display Matrix` (SideData) -> "Display matrix (stream 0)".
 */
export function humanizeTag(tag: string): string {
  if (OVERRIDES[tag]) return OVERRIDES[tag];
  if (/^0x[0-9a-f]+$/i.test(tag)) return tag; // undocumented numeric tag ids stay as is

  const side = /^(\d+):(.+)$/.exec(tag);
  if (side) return `${humanizeTag(side[2]!)} (stream ${side[1]})`;

  const reverseDns = /^(?:com|org|net|io)\.([a-z0-9]+)\.(.+)$/i.exec(tag);
  if (reverseDns) {
    const parts = reverseDns[2]!.split('.');
    const name = parts.pop() as string;
    const vendor = VENDOR_NAMES[reverseDns[1]!.toLowerCase()] ?? humanizeTag(reverseDns[1]!);
    const product = parts.length
      ? ` ${parts.map((p) => (p === 'quicktime' ? 'QuickTime' : humanizeTag(p))).join(' ')}`
      : '';
    return `${humanizeTag(name)} (${vendor}${product})`;
  }

  const words = tag.split(/[_\-\s]+/).flatMap((chunk) => splitWords(chunk));
  return words.length ? sentenceCase(words) : tag;
}

/**
 * Label for a synthetic ffprobe group. `Stream:0` + codec type -> "Video stream 0".
 * Other groups are returned unchanged.
 */
export function streamLabel(group: string, streamType?: string): string {
  const m = /^Stream:(\d+)$/.exec(group);
  if (m) {
    const type = streamType
      ? streamType.charAt(0).toUpperCase() + streamType.slice(1).toLowerCase()
      : 'Stream';
    return streamType ? `${type} stream ${m[1]}` : `Stream ${m[1]}`;
  }
  const c = /^Chapter:(\d+)$/.exec(group);
  if (c) return `Chapter ${Number(c[1]) + 1}`;
  return group;
}
