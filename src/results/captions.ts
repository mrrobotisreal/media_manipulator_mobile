/** Verbatim port of media-manipulator-ui `lib/results/captions.ts` (web main, 2026-11-02). */
/**
 * Pure SRT/VTT parser and formatters (MM03). No DOM, no React, never throws: malformed
 * blocks become `warnings`. Cue tags (`<v Speaker>`, `<i>`) are kept verbatim as text.
 */

export interface Cue {
  /** 1-based position in the file, regardless of any id the source carried. */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** VTT cue settings (`align:start position:10%`), verbatim. */
  settings?: string;
}

export type CaptionFormat = 'srt' | 'vtt';

export interface ParsedCaptions {
  format: CaptionFormat;
  cues: Cue[];
  warnings: string[];
}

const TS = '(?:(\\d+):)?(\\d{1,2}):(\\d{2})(?:[.,](\\d{1,3}))?';
const TIMING = new RegExp(`^\\s*${TS}\\s*-->\\s*${TS}(.*)$`);

function toMs(h: string | undefined, m: string, s: string, frac: string | undefined): number {
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

export function parseCaptions(text: string, hint?: CaptionFormat): ParsedCaptions {
  const warnings: string[] = [];
  const cues: Cue[] = [];
  const src = (text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const isVtt = /^\s*WEBVTT/.test(src);
  const format: CaptionFormat = isVtt
    ? 'vtt'
    : (hint ?? (/\d,\d{1,3}\s*-->/.test(src) ? 'srt' : /-->/.test(src) ? 'vtt' : 'srt'));

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of src.split('\n')) {
    if (line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  blocks.forEach((rawLines, blockNo) => {
    let lines = rawLines;
    const first = lines[0]!.trim();
    if (blockNo === 0 && /^WEBVTT/.test(first)) {
      const at = lines.findIndex((l) => l.includes('-->'));
      if (at < 0) return;
      lines = lines.slice(at);
    } else if (/^(NOTE|STYLE|REGION)(\s|$)/.test(first)) {
      return;
    }
    const timingAt = lines.findIndex((l) => l.includes('-->'));
    if (timingAt < 0 || timingAt > 1) {
      warnings.push(`Block ${blockNo + 1}: no timing line, skipped.`);
      return;
    }
    const match = TIMING.exec(lines[timingAt]!);
    if (!match) {
      warnings.push(
        `Block ${blockNo + 1}: unreadable timing "${lines[timingAt]!.trim()}", skipped.`,
      );
      return;
    }
    const startMs = toMs(match[1], match[2]!, match[3]!, match[4]);
    const endMs = toMs(match[5], match[6]!, match[7]!, match[8]);
    if (endMs < startMs) {
      warnings.push(`Block ${blockNo + 1}: ends before it starts, skipped.`);
      return;
    }
    const cue: Cue = {
      index: cues.length + 1,
      startMs,
      endMs,
      text: lines.slice(timingAt + 1).join('\n'),
    };
    const settings = (match[9] ?? '').trim();
    if (settings && format === 'vtt') cue.settings = settings;
    cues.push(cue);
  });

  return { format, cues, warnings };
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** `srt` -> `HH:MM:SS,mmm`, `vtt` -> `HH:MM:SS.mmm`, `display` -> `m:ss` or `h:mm:ss`. */
export function formatTimestamp(ms: number, style: CaptionFormat | 'display'): string {
  const total = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const milli = total % 1000;
  if (style === 'display') return h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${m}:${pad(s, 2)}`;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${style === 'srt' ? ',' : '.'}${pad(milli, 3)}`;
}

export function formatCaptions(cues: readonly Cue[], format: CaptionFormat): string {
  const body = cues
    .map((cue, i) => {
      const text = cue.text.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');
      const timing = `${formatTimestamp(cue.startMs, format)} --> ${formatTimestamp(cue.endMs, format)}`;
      if (format === 'srt') return `${i + 1}\n${timing}\n${text}\n`;
      return `${timing}${cue.settings ? ` ${cue.settings}` : ''}\n${text}\n`;
    })
    .join('\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body;
}
