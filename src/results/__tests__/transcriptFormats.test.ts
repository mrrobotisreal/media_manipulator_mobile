import { parseCaptions } from '../captions';
import { renderTranscript, transcriptCues } from '../transcriptFormats';

const result = {
  language: 'ru',
  durationSeconds: 9.5,
  transcriptText: 'ignored when segments exist',
  segments: [
    { id: 0, start: 0.12, end: 2.4, text: ' Привет, мир ' },
    { id: 1, start: 2.4, end: 5.0005, text: 'Second line — “quoted” 日本語' },
    { id: 2, start: 3725.5, end: 3726.25, text: 'Late' },
  ],
};

describe('renderTranscript', () => {
  it('srt', () => {
    expect(
      renderTranscript(result, 'srt').startsWith('1\n00:00:00,120 --> 00:00:02,400\nПривет, мир\n'),
    ).toBe(true);
  });
  it('vtt', () => {
    const out = renderTranscript(result, 'vtt');
    expect(out.startsWith('WEBVTT\n\n00:00:00.120 --> 00:00:02.400\n')).toBe(true);
    expect(out).toContain('01:02:05.500 --> 01:02:06.250');
  });
  it('txt is one segment per line, no timestamps', () => {
    expect(renderTranscript(result, 'txt')).toBe(
      'Привет, мир\nSecond line — “quoted” 日本語\nLate',
    );
  });
  it('json is pretty-printed', () => {
    const out = renderTranscript(result, 'json');
    expect(out).toContain('\n  "language": "ru"');
    expect(JSON.parse(out)).toEqual({
      language: 'ru',
      durationSeconds: 9.5,
      segments: result.segments,
    });
  });
  it('falls back to transcriptText without segments', () => {
    const bare = { transcriptText: 'Just text', durationSeconds: 3 };
    expect(renderTranscript(bare, 'txt')).toBe('Just text');
    expect(renderTranscript(bare, 'srt')).toContain('00:00:00,000 --> 00:00:03,000\nJust text');
    expect(JSON.parse(renderTranscript(bare, 'json')).segments).toEqual([]);
    expect(renderTranscript({}, 'vtt')).toBe('WEBVTT\n\n');
  });
  it('round trip: srt and vtt parse back to the segments within 1 ms', () => {
    for (const format of ['srt', 'vtt'] as const) {
      const parsed = parseCaptions(renderTranscript(result, format), format);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.cues).toHaveLength(result.segments.length);
      parsed.cues.forEach((cue, i) => {
        expect(Math.abs(cue.startMs - result.segments[i]!.start * 1000)).toBeLessThanOrEqual(1);
        expect(Math.abs(cue.endMs - result.segments[i]!.end * 1000)).toBeLessThanOrEqual(1);
        expect(cue.text).toBe(result.segments[i]!.text.trim());
      });
    }
  });
  it('transcriptCues is empty with no data', () => {
    expect(transcriptCues({})).toEqual([]);
  });
});
