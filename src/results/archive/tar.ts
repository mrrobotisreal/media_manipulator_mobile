import { kindOfFileName } from '../describe';
import type { ArchiveEntry } from './types';

const BLOCK = 512;
const decoder = new TextDecoder('utf-8');

const isZeroBlock = (b: Uint8Array, at: number) => {
  for (let i = at; i < at + BLOCK; i++) if (b[i] !== 0) return false;
  return true;
};

const cstring = (b: Uint8Array, from: number, len: number) => {
  let end = from;
  const max = from + len;
  while (end < max && b[end] !== 0) end++;
  return decoder.decode(b.subarray(from, end));
};

/** Octal (or GNU base-256) number field. */
function field(b: Uint8Array, from: number, len: number): number {
  const first = b[from] ?? 0;
  if (first & 0x80) {
    let n = first & 0x7f;
    for (let i = 1; i < len; i++) n = n * 256 + (b[from + i] ?? 0);
    return n;
  }
  const text = cstring(b, from, len).trim();
  return text ? parseInt(text, 8) || 0 : 0;
}

/** PAX extended header: `len key=value\n` records. Only `path` and `size` matter here. */
function parsePax(data: Uint8Array): { path?: string; size?: number } {
  const out: { path?: string; size?: number } = {};
  let at = 0;
  while (at < data.length) {
    let sp = at;
    while (sp < data.length && data[sp] !== 0x20) sp++;
    const len = parseInt(decoder.decode(data.subarray(at, sp)), 10);
    if (!Number.isFinite(len) || len <= 0 || at + len > data.length) break;
    const record = decoder.decode(data.subarray(sp + 1, at + len - 1));
    const eq = record.indexOf('=');
    if (eq > 0) {
      const key = record.slice(0, eq);
      const value = record.slice(eq + 1);
      if (key === 'path') out.path = value;
      else if (key === 'size') out.size = Number(value);
    }
    at += len;
  }
  return out;
}

const cleanPath = (p: string) => p.replace(/^\.?\/+/, '').replace(/\/+$/, '');

/**
 * Reads a ustar archive: 512-byte headers, octal sizes, typeflag 0 / NUL (file) and 5 (dir),
 * GNU `L` long names and PAX `x` paths. Stops at two zero blocks. Never throws on a short
 * input: it returns the entries read completely plus `truncated: true`.
 */
export function readTar(bytes: Uint8Array): { entries: ArchiveEntry[]; truncated: boolean } {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let zeroBlocks = 0;
  let longName: string | undefined;
  let pax: { path?: string; size?: number } | undefined;

  while (offset < bytes.length) {
    if (offset + BLOCK > bytes.length) return { entries, truncated: true };
    if (isZeroBlock(bytes, offset)) {
      zeroBlocks += 1;
      offset += BLOCK;
      if (zeroBlocks >= 2) break;
      continue;
    }
    zeroBlocks = 0;
    const flag = String.fromCharCode(bytes[offset + 156] || 0x30);
    let size = field(bytes, offset + 124, 12);
    const magic = cstring(bytes, offset + 257, 5);
    let name = cstring(bytes, offset, 100);
    if (magic === 'ustar') {
      const prefix = cstring(bytes, offset + 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (pax?.size !== undefined && Number.isFinite(pax.size)) size = pax.size;
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) return { entries, truncated: true };
    const data = bytes.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === 'L') {
      longName = cstring(data, 0, data.length);
      continue;
    }
    if (flag === 'x') {
      pax = parsePax(data);
      continue;
    }
    if (flag === 'g') continue;

    const path = cleanPath(longName ?? pax?.path ?? name);
    longName = undefined;
    const isDir = flag === '5' || name.endsWith('/');
    pax = undefined;
    if ((flag === '0' || flag === '\0' || flag === '5') && path) {
      entries.push({
        path,
        size: isDir ? 0 : size,
        isDir,
        kind: isDir ? 'unknown' : kindOfFileName(path),
        data: isDir ? undefined : () => data,
      });
    }
  }
  return { entries, truncated: false };
}
