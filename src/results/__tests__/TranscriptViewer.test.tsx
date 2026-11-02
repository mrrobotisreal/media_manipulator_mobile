import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { transcribeResultSchema, analysisResultSchema } from '@/api/schemas/transcript';
import { i18n } from '@/i18n';
import { track } from '@/analytics/track';
import { mmBaseQuery } from '@/api/baseQuery';
import { formatCaptions, parseCaptions } from '../captions';
import { analysisPollInterval, analysisUiState } from '../analysisPolling';
import {
  EXPORT_FORMATS,
  captionSource,
  exportFileName,
  filterCues,
  sourceFromCues,
  sourceFromTranscript,
} from '../transcriptModel';
import { copyTranscript, exportTranscript } from '../transcriptActions';
import { transcriptCues } from '../transcriptFormats';
import { TranscriptPanel } from '../viewers/TranscriptPanel';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const RESULT = transcribeResultSchema.parse({
  format: 'vtt',
  language: 'de',
  hasAudio: true,
  hasSpeech: true,
  segmentCount: 3,
  durationSeconds: 12.5,
  outputFile: 'talk.vtt',
  segments: [
    { id: 0, start: 0, end: 2.5, text: ' Guten Morgen ' },
    { id: 1, start: 2.5, end: 5, text: 'Wie geht es dir?' },
    { id: 2, start: 5, end: 7.25, text: 'Mir geht es gut, danke.' },
  ],
});

const VTT =
  'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nPrivet\n\n00:00:02.500 --> 00:00:04.000\nKak dela\n';

function deps() {
  return { copy: jest.fn(async () => undefined), shareText: jest.fn(async () => undefined) };
}

async function mountPanel(props: Partial<React.ComponentProps<typeof TranscriptPanel>> = {}) {
  const d = deps();
  await render(
    <I18nextProvider i18n={i18n}>
      <TranscriptPanel
        source={sourceFromTranscript(RESULT)}
        fileName="talk.vtt"
        jobId="job-1"
        deps={d}
        {...props}
      />
    </I18nextProvider>,
  );
  return d;
}

describe('TranscriptPanel', () => {
  beforeEach(() => (track as jest.Mock).mockClear());

  it('renders cues from a fixture with display timestamps and the cue count', async () => {
    await mountPanel();
    expect(screen.getAllByTestId('cue-row')).toHaveLength(3);
    expect(screen.getByText('Guten Morgen')).toBeTruthy();
    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByTestId('cue-count').props.children).toContain('3');
  });

  it('filters by search and shows the empty-match line', async () => {
    await mountPanel();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Search the transcript'), 'GEHT');
    });
    expect(screen.getAllByTestId('cue-row')).toHaveLength(2);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Search the transcript'), 'zzz');
    });
    expect(screen.getByTestId('no-matches')).toBeTruthy();
  });

  it('exports SRT text equal to formatCaptions and fires feature_used', async () => {
    const d = await mountPanel();
    await act(async () => {
      fireEvent.press(screen.getByText('Export as SRT'));
    });
    expect(d.shareText).toHaveBeenCalledTimes(1);
    const [name, mime, content, jobId] = d.shareText.mock.calls[0] as unknown as string[];
    expect(name).toBe('talk.srt');
    expect(mime).toBe('application/x-subrip');
    expect(jobId).toBe('job-1');
    expect(content).toBe(formatCaptions(transcriptCues(RESULT), 'srt'));
    expect(track).toHaveBeenCalledWith('feature_used', {
      feature: 'transcript',
      action: 'export',
      value: 'srt',
    });
  });

  it('copies all text and never sends the text to analytics', async () => {
    const d = await mountPanel();
    await act(async () => {
      fireEvent.press(screen.getByText('Copy all'));
    });
    expect(d.copy).toHaveBeenCalledWith('Guten Morgen\nWie geht es dir?\nMir geht es gut, danke.');
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toContain('Guten');
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('shows the no-speech state instead of a list', async () => {
    await mountPanel({
      source: sourceFromTranscript({ ...RESULT, segments: undefined }),
      emptyReason: 'noSpeech',
    });
    expect(screen.getByTestId('no-speech')).toBeTruthy();
    expect(screen.queryByTestId('cue-row')).toBeNull();
  });

  it('never emits transcript_cue_seeked (a cue tap does not seek in v1)', async () => {
    await mountPanel();
    await act(async () => {
      fireEvent.press(screen.getByText('Guten Morgen'));
    });
    const names = (track as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).not.toContain('transcript_cue_seeked');
  });

  it('virtualizes a two-hour transcript (thousands of cues) without rendering them all', async () => {
    const segments = Array.from({ length: 4000 }, (_, i) => ({
      id: i,
      start: i * 1.8,
      end: i * 1.8 + 1.7,
      text: `line ${i}`,
    }));
    await mountPanel({ source: sourceFromTranscript({ ...RESULT, segments }) });
    expect(screen.getAllByTestId('cue-row').length).toBeLessThan(200);
    expect(screen.getByTestId('cue-count').props.children).toContain('4');
  });
});

describe('transcript model', () => {
  it('captions from a VTT fixture parse into cues and export every format', () => {
    const src = captionSource(VTT);
    expect(src.cues.map((c) => c.text)).toEqual(['Privet', 'Kak dela']);
    expect(src.render('srt')).toBe(formatCaptions(parseCaptions(VTT).cues, 'srt'));
    expect(src.render('txt')).toBe('Privet\nKak dela');
    expect(JSON.parse(src.render('json')).segments).toHaveLength(2);
    expect(src.durationSeconds).toBe(4);
  });

  it('CaptionsViewer fallback: a VTT renders in the panel', async () => {
    await mountPanel({ source: captionSource(VTT), fileName: 'in.vtt' });
    expect(screen.getAllByTestId('cue-row')).toHaveLength(2);
  });

  it('filterCues is case-insensitive and keeps all on an empty query', () => {
    const cues = sourceFromCues(parseCaptions(VTT).cues).cues;
    expect(filterCues(cues, '').length).toBe(2);
    expect(filterCues(cues, ' KAK ').length).toBe(1);
  });

  it('export names follow the result name', () => {
    expect(exportFileName('talk_transcript.vtt', 'srt')).toBe('talk_transcript.srt');
    expect(exportFileName('noext', 'json')).toBe('noext.json');
    expect(EXPORT_FORMATS).toEqual(['srt', 'vtt', 'txt', 'json']);
  });

  it('copy and export call the injected deps', async () => {
    const d = deps();
    await copyTranscript(sourceFromTranscript(RESULT), d);
    await exportTranscript(sourceFromTranscript(RESULT), 'json', 'a.vtt', 'j', d);
    expect(d.copy).toHaveBeenCalledTimes(1);
    expect((d.shareText.mock.calls as unknown as string[][])[0]?.[0]).toBe('a.json');
  });
});

describe('analysis polling cap', () => {
  it('polls every 4 s, stops with data, stops after 5 minutes', () => {
    expect(analysisPollInterval(0, 1000, false)).toBe(4000);
    expect(analysisPollInterval(0, 1000, true)).toBe(0);
    expect(analysisPollInterval(0, 5 * 60 * 1000, false)).toBe(0);
    expect(analysisUiState(false, 0, 1000)).toBe('running');
    expect(analysisUiState(false, 0, 5 * 60 * 1000)).toBe('unavailable');
    expect(analysisUiState(true, 0, 9e9)).toBe('ready');
  });
});

describe('Zod contract', () => {
  it('rejects a malformed transcript and analysis', () => {
    expect(transcribeResultSchema.safeParse({ format: 'doc', hasAudio: 'yes' }).success).toBe(
      false,
    );
    expect(
      transcribeResultSchema.safeParse({ ...RESULT, segments: [{ start: 'x' }] }).success,
    ).toBe(false);
    expect(analysisResultSchema.safeParse({ transcriptReview: { main_topics: 'x' } }).success).toBe(
      false,
    );
    expect(analysisResultSchema.safeParse({}).success).toBe(true);
  });

  it('a malformed 200 body becomes contract_mismatch, not a crash', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"format":"nope"}'),
      }),
    ) as unknown as typeof fetch;
    const dispatch = jest.fn();
    try {
      const res = await mmBaseQuery(
        { url: '/transcript/j', schema: transcribeResultSchema },
        {
          dispatch,
          signal: new AbortController().signal,
          getState: () => ({}),
          abort: jest.fn(),
          extra: {},
          endpoint: 'getTranscript',
          type: 'query',
          forced: false,
        } as never,
        {},
      );
      expect((res as { error: { code: string } }).error.code).toBe('contract_mismatch');
    } finally {
      global.fetch = realFetch;
    }
  });
});
