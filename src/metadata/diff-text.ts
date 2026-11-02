// Ported from media-manipulator-ui lib/metadata/diff-text.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * Pure helpers for the metadata diff (MM10): character-level string diff, numeric delta,
 * the expected-change list and the "copy diff as text" serializer.
 *
 * The design doc names the `diff` package; this local Myers implementation replaces it so the
 * ticket adds no dependency (recorded in the MM10 session log). No React, no components.
 */
import type { MetadataEntry } from './types';

export type CharOp = { type: 'equal' | 'remove' | 'add'; text: string };

/** Above this `before.length * after.length` the diff degrades to a whole-value replace. */
export const CHAR_DIFF_LIMIT = 250_000;

function push(out: CharOp[], type: CharOp['type'], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

/** Myers O(ND) diff over code points (so emoji and astral characters are never split). */
export function diffChars(before: string, after: string): CharOp[] {
  if (before === after) return before ? [{ type: 'equal', text: before }] : [];
  const a = Array.from(before);
  const b = Array.from(after);
  const out: CharOp[] = [];
  if (a.length * b.length > CHAR_DIFF_LIMIT) {
    push(out, 'remove', before);
    push(out, 'add', after);
    return out;
  }
  // Trim the common prefix/suffix; Myers handles the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  push(out, 'equal', a.slice(0, start).join(''));
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  if (n === 0) push(out, 'add', B.join(''));
  else if (m === 0) push(out, 'remove', A.join(''));
  else {
    const max = n + m;
    const offset = max;
    let v = new Int32Array(2 * max + 2);
    const trace: Int32Array[] = [];
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!))
          x = v[offset + k + 1]!;
        else x = v[offset + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          found = true;
          break;
        }
      }
      if (!found) v = v.slice();
    }
    // Backtrack to ops (reversed).
    const ops: CharOp[] = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const tv = trace[d]!;
      const k = x - y;
      let prevK: number;
      if (k === -d || (k !== d && tv[offset + k - 1]! < tv[offset + k + 1]!)) prevK = k + 1;
      else prevK = k - 1;
      const prevX = tv[offset + prevK]!;
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        x--;
        y--;
        ops.push({ type: 'equal', text: A[x]! });
      }
      if (d > 0) {
        if (x === prevX) {
          y--;
          ops.push({ type: 'add', text: B[y]! });
        } else {
          x--;
          ops.push({ type: 'remove', text: A[x]! });
        }
      }
    }
    for (let i = ops.length - 1; i >= 0; i--) push(out, ops[i]!.type, ops[i]!.text);
  }
  push(out, 'equal', a.slice(endA).join(''));
  return out;
}

export interface NumericDelta {
  from: number;
  to: number;
  delta: number;
}

const NUM = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/;

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && NUM.test(v)) return Number(v);
  return undefined;
}

/** `{from,to,delta}` when both values are numbers (or plain numeric strings), else undefined. */
export function numericDelta(before: unknown, after: unknown): NumericDelta | undefined {
  const from = asNumber(before);
  const to = asNumber(after);
  if (from === undefined || to === undefined) return undefined;
  const delta = Math.round((to - from) * 1e9) / 1e9;
  return { from, to, delta };
}

/** "a → b (+d)" for numeric pairs, else undefined. */
export function formatNumericChange(before: unknown, after: unknown): string | undefined {
  const n = numericDelta(before, after);
  if (!n) return undefined;
  return `${n.from} → ${n.to} (${n.delta > 0 ? '+' : ''}${n.delta})`;
}

/**
 * Tags that always differ between an input and its converted output. Mirrors the API's
 * `metadata.IsExpectedChange` (internal/metadata/diff.go) exactly: strip a `#n` suffix, split
 * `group:tag`; `Composite:ImageSize`; or group `System`/`File` with tag FileName, FileSize,
 * FileModifyDate, MIMEType or a `FileType*` prefix.
 */
export function isExpectedChange(id: string): boolean {
  const hash = id.indexOf('#');
  const key = hash >= 0 ? id.slice(0, hash) : id;
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) return false;
  const group = key.slice(0, i);
  const tag = key.slice(i + 1);
  if (group === 'Composite' && tag === 'ImageSize') return true;
  if (group === 'System' || group === 'File') {
    if (tag === 'FileName' || tag === 'FileSize' || tag === 'FileModifyDate' || tag === 'MIMEType')
      return true;
    return tag.startsWith('FileType');
  }
  return false;
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((x) => typeof x !== 'object' || x === null))
    return value.join(', ');
  return JSON.stringify(value);
}

export interface DiffTextChanged {
  id: string;
  before?: unknown;
  after?: unknown;
}

export interface DiffTextInput {
  removed: readonly MetadataEntry[];
  added: readonly MetadataEntry[];
  changed: readonly DiffTextChanged[];
  unchanged: number;
}

export interface DiffTextOptions {
  /** Category of a changed id (changed rows carry none); defaults to 'other'. */
  categoryOf?: (id: string) => string;
  /** Which kinds to print (the modal's filters). Default: removed, added, changed. */
  show?: { removed?: boolean; added?: boolean; changed?: boolean };
  /** Appends a `# N unchanged` line when true. */
  mentionUnchanged?: boolean;
}

const oneLine = (s: string) => s.replace(/\r?\n/g, '\\n');

/** Unified-text rendition for "Copy diff as text". Categories in first-seen order. */
export function diffToText(
  diff: DiffTextInput,
  names: { original: string; result: string },
  opts: DiffTextOptions = {},
): string {
  const show = { removed: true, added: true, changed: true, ...opts.show };
  const byCat = new Map<string, string[]>();
  const add = (cat: string, line: string) => {
    const list = byCat.get(cat);
    if (list) list.push(line);
    else byCat.set(cat, [line]);
  };
  if (show.removed)
    for (const e of diff.removed)
      add(e.category || 'other', `- ${e.id}: ${oneLine(valueText(e.value))}`);
  if (show.added)
    for (const e of diff.added)
      add(e.category || 'other', `+ ${e.id}: ${oneLine(valueText(e.value))}`);
  if (show.changed) {
    for (const c of diff.changed) {
      const cat = opts.categoryOf?.(c.id) ?? 'other';
      const before = oneLine(valueText(c.before));
      const after = oneLine(valueText(c.after));
      const numeric = formatNumericChange(c.before, c.after);
      add(cat, `~ ${c.id}: ${numeric ?? `${before} → ${after}`}`);
    }
  }
  const lines = [`--- ${names.original}`, `+++ ${names.result}`];
  for (const [cat, list] of byCat) {
    lines.push(`@@ ${cat} @@`, ...list);
  }
  if (opts.mentionUnchanged) lines.push(`# ${diff.unchanged} unchanged`);
  return lines.join('\n') + '\n';
}
