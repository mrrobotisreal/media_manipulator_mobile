import { formatCaptions, formatTimestamp, parseCaptions } from '../captions';

const FIXTURES = {
  plainSrt:
    '1\n00:00:01,000 --> 00:00:03,500\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue\n',
  vttWithHeaderNoteStyle:
    'WEBVTT - title\n\nNOTE a comment\nover two lines\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:02.000 align:start\n<v Alina>Privet</v>\n\n00:00:02.500 --> 00:00:04.000\nKak dela\n',
  bomCrlf:
    '﻿1\r\n00:00:00,500 --> 00:00:01,250\r\nBom line\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nSecond\r\n',
  dotSeparatorInSrt: '1\n00:00:01.250 --> 00:00:02.500\nDots in srt\n',
  commaSeparatorInVtt: 'WEBVTT\n\n00:01,250 --> 00:02,500\nCommas in vtt\n',
  vttNoHours: 'WEBVTT\n\n01:02.003 --> 01:04.000\nShort form\n',
  multiLine: '1\n00:00:01,000 --> 00:00:02,000\nLine one\nLine two\n<i>Line three</i>\n',
  cueIds:
    'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000\nWith id\n\nouter-2\n00:00:03.000 --> 00:00:04.000\nAnother\n',
  invalidBlocks:
    '1\n00:00:05,000 --> 00:00:01,000\nbackwards\n\n2\nnot a timing line\ntext\n\n3\n00:00:01,000 --> 00:00:03,000\nOverlap A\n\n4\n00:00:02,000 --> 00:00:04,000\nOverlap B\n',
};

describe('parseCaptions fixtures', () => {
  it('plain SRT', () => {
    const r = parseCaptions(FIXTURES.plainSrt);
    expect(r.format).toBe('srt');
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      { index: 1, startMs: 1000, endMs: 3500, text: 'Hello there' },
      { index: 2, startMs: 4000, endMs: 6000, text: 'Second cue' },
    ]);
  });

  it('VTT with header, NOTE and STYLE blocks', () => {
    const r = parseCaptions(FIXTURES.vttWithHeaderNoteStyle);
    expect(r.format).toBe('vtt');
    expect(r.warnings).toEqual([]);
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0]).toEqual({
      index: 1,
      startMs: 1000,
      endMs: 2000,
      text: '<v Alina>Privet</v>',
      settings: 'align:start',
    });
  });

  it('BOM + CRLF', () => {
    const r = parseCaptions(FIXTURES.bomCrlf);
    expect(r.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [500, 1250, 'Bom line'],
      [2000, 3000, 'Second'],
    ]);
  });

  it('comma and dot millisecond separators', () => {
    expect(parseCaptions(FIXTURES.dotSeparatorInSrt, 'srt').cues[0]!.startMs).toBe(1250);
    expect(parseCaptions(FIXTURES.commaSeparatorInVtt).cues[0]!.endMs).toBe(2500);
  });

  it('VTT without hours', () => {
    const cue = parseCaptions(FIXTURES.vttNoHours).cues[0]!;
    expect(cue.startMs).toBe(62_003);
    expect(cue.endMs).toBe(64_000);
  });

  it('multi-line cues keep tags verbatim', () => {
    const cue = parseCaptions(FIXTURES.multiLine).cues[0]!;
    expect(cue.text).toBe('Line one\nLine two\n<i>Line three</i>');
  });

  it('cue ids are not treated as text', () => {
    const r = parseCaptions(FIXTURES.cueIds);
    expect(r.cues.map((c) => c.text)).toEqual(['With id', 'Another']);
    expect(r.cues.map((c) => c.index)).toEqual([1, 2]);
  });

  it('overlapping and invalid blocks warn without throwing', () => {
    const r = parseCaptions(FIXTURES.invalidBlocks);
    expect(r.warnings).toHaveLength(2);
    expect(r.cues.map((c) => c.text)).toEqual(['Overlap A', 'Overlap B']);
  });

  it('empty and garbage input yields zero cues', () => {
    expect(parseCaptions('')).toMatchObject({ cues: [], warnings: [] });
    expect(parseCaptions('   \n\n  ').cues).toEqual([]);
    expect(() => parseCaptions(undefined as unknown as string)).not.toThrow();
    expect(parseCaptions('just some words').cues).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats timestamps', () => {
    expect(formatTimestamp(3_723_456, 'srt')).toBe('01:02:03,456');
    expect(formatTimestamp(3_723_456, 'vtt')).toBe('01:02:03.456');
    expect(formatTimestamp(65_000, 'display')).toBe('1:05');
    expect(formatTimestamp(3_723_456, 'display')).toBe('1:02:03');
    expect(formatTimestamp(-5, 'srt')).toBe('00:00:00,000');
  });

  it.each(['srt', 'vtt'] as const)('parse -> format -> parse is the identity (%s)', (format) => {
    const sources = Object.entries(FIXTURES).filter(([name]) => name !== 'invalidBlocks');
    for (const [, text] of sources) {
      const first = parseCaptions(text, format);
      const second = parseCaptions(formatCaptions(first.cues, format), format);
      const strip = (cues: typeof first.cues) =>
        cues.map((c) => (format === 'srt' ? { ...c, settings: undefined } : c));
      expect(strip(second.cues)).toEqual(strip(first.cues));
    }
  });
});
