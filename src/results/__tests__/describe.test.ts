import { API_BASE_URL } from '@/api/config';
import { TOOLS } from '@/tools/registry';
import {
  describe as describeResult,
  extensionOf,
  kindOfFileName,
  kindOfOriginal,
  mimeForFileName,
  type ResultKind,
  type ResultMode,
} from '../describe';

const job = (resultFileName?: string, extra: Record<string, unknown> = {}) => ({
  id: 'job-1',
  resultFileName,
  ...extra,
});

/** [task, mode, output file name, expected kind] - one row per task x plausible output. */
const MATRIX: [string | undefined, ResultMode | undefined, string | undefined, ResultKind][] =
  [
    // Images
    ['image_converter', 'convert', 'photo.jpg', 'image'],
    ['image_converter', 'convert', 'photo.JPEG', 'image'],
    ['image_converter', 'convert', 'photo.png', 'image'],
    ['image_converter', 'convert', 'photo.webp', 'image'],
    ['image_converter', 'convert', 'photo.avif', 'image'],
    ['image_converter', 'convert', 'photo.bmp', 'image'],
    ['image_converter', 'convert', 'photo.tiff', 'image'],
    ['png_to_ico', 'convert', 'icon.ico', 'image'],
    ['png_to_svg', 'convert', 'logo.svg', 'image'],
    ['svg_to_png', 'convert', 'logo.png', 'image'],
    ['heic_to_jpg', 'convert', 'IMG_1.jpg', 'image'],
    ['avif_to_png', 'convert', 'a.png', 'image'],
    ['remove_background', 'convert', 'cutout.png', 'image'],
    ['remove_metadata', 'convert', 'clean.jpg', 'image'],
    ['image_resizer', 'convert', 'small.webp', 'image'],
    ['compress_image', 'convert', 'smaller.jpg', 'image'],
    // GIF
    ['video_to_gif', 'convert', 'clip.gif', 'gif'],
    ['mp4_to_gif', 'convert', 'clip.gif', 'gif'],
    ['gif_converter', 'convert', 'clip.gif', 'gif'],
    ['image_converter', 'convert', 'anim.gif', 'gif'],
    // Video
    ['video_converter', 'convert', 'out.mp4', 'video'],
    ['video_converter', 'convert', 'out.webm', 'video'],
    ['mov_to_mp4', 'convert', 'out.mp4', 'video'],
    ['mkv_to_mp4', 'convert', 'out.mp4', 'video'],
    ['avi_to_mp4', 'convert', 'out.mp4', 'video'],
    ['mp4_to_webm', 'convert', 'out.webm', 'video'],
    ['compress_video', 'convert', 'small.mp4', 'video'],
    ['crop_video', 'convert', 'crop.mov', 'video'],
    ['rotate_video', 'convert', 'rot.mkv', 'video'],
    ['remove_audio_from_video', 'convert', 'mute.mp4', 'video'],
    ['stitch_audio_to_video', 'convert', 'stitched.mp4', 'video'],
    ['ai_frame_interpolation', 'convert', 'smooth.mp4', 'video'],
    ['edit_video', 'convert', 'edit.avi', 'video'],
    // Audio
    ['audio_converter', 'convert', 'a.mp3', 'audio'],
    ['audio_converter', 'convert', 'a.wav', 'audio'],
    ['audio_converter', 'convert', 'a.m4a', 'audio'],
    ['wav_to_mp3', 'convert', 'a.mp3', 'audio'],
    ['extract_audio', 'convert', 'a.aac', 'audio'],
    ['mp4_to_mp3', 'convert', 'a.mp3', 'audio'],
    ['video_to_mp3', 'convert', 'a.flac', 'audio'],
    ['isolate_vocals', 'convert', 'vocals.ogg', 'audio'],
    ['audio_waveform', 'convert', 'wave.opus', 'audio'],
    // Transcripts and captions
    ['transcribe_video', 'transcribe', 'talk_transcript.txt', 'transcript'],
    ['transcribe_video', 'transcribe', 'talk_transcript.json', 'transcript'],
    ['transcribe_video', 'transcribe', 'talk_transcript.srt', 'captions'],
    ['transcribe_video', 'transcribe', 'talk_transcript.vtt', 'captions'],
    ['srt_generator', 'transcribe', 'talk.srt', 'captions'],
    ['caption_translator', 'convert', 'talk_es.srt', 'captions'],
    ['caption_translator', 'convert', 'talk_es.vtt', 'captions'],
    // txt/json outside a transcribe context is not a transcript
    ['image_converter', 'convert', 'data.json', 'unknown'],
    ['image_converter', 'convert', 'notes.txt', 'unknown'],
    // PDF
    ['image_to_pdf', 'convert', 'scan.pdf', 'pdf'],
    ['jpg_to_pdf', 'convert', 'scan.pdf', 'pdf'],
    ['pdf_converter', 'document', 'scan.pdf', 'pdf'],
    // PDF to image: single page is an image, all pages is a zip
    ['pdf_to_jpg', 'convert', 'doc_converted.jpg', 'image'],
    ['pdf_to_png', 'convert', 'doc_pages.zip', 'archive'],
    // Archives
    ['extract_frames', 'convert', 'frames.zip', 'archive'],
    ['extract_frames', 'convert', 'frames.tar.gz', 'archive'],
    ['extract_frames', 'convert', 'frames.tgz', 'archive'],
    ['pdf_to_jpg', 'convert', 'scan_pages.zip', 'archive'],
    ['transcode_to_dash', 'transcode', 'dash-package.zip', 'dash'],
    ['transcode_to_hls', 'transcode', 'hls-package.tgz', 'hls'],
    ['ai_video_restoration', 'transcode', 'restoration.tgz', 'hls'],
    ['ai_video_restoration', 'convert', 'restoration_results.tar.gz', 'archive'],
    // Transcode bundles
    ['transcode_to_hls', 'transcode', 'hls-package.tar.gz', 'hls'],
    ['transcode_to_dash', 'transcode', 'dash-package.tar.gz', 'dash'],
    ['transcode_to_hls', undefined, 'hls-package.zip', 'hls'],
    [undefined, 'transcode', 'package.tar.gz', 'hls'],
    // No file name from the API: task or mode decides
    ['transcribe_video', 'transcribe', undefined, 'transcript'],
    ['srt_generator', undefined, undefined, 'captions'],
    ['caption_translator', undefined, undefined, 'captions'],
    ['extract_frames', undefined, undefined, 'archive'],
    ['transcode_to_dash', 'transcode', undefined, 'dash'],
    ['compress_video', undefined, undefined, 'video'],
    ['audio_converter', undefined, undefined, 'audio'],
    // Unknown
    ['image_converter', 'convert', 'mystery.xyz', 'unknown'],
    ['image_converter', 'convert', undefined, 'unknown'],
    [undefined, undefined, undefined, 'unknown'],
  ];

describe('describe() kind matrix', () => {
  it('has at least 40 rows', () => {
    expect(MATRIX.length).toBeGreaterThanOrEqual(40);
  });

  it.each(MATRIX)('task=%s mode=%s file=%s -> %s', (task, mode, fileName, expected) => {
    expect(describeResult({ job: job(fileName), task, mode }).kind).toBe(expected);
  });
});

describe('describe() details', () => {
  it('never reads Content-Type: a lying resultMime does not change the kind', () => {
    const d = describeResult({
      job: job('clip.mp4', { resultMime: 'text/plain' }),
      task: 'compress_video',
    });
    expect(d.kind).toBe('video');
  });

  it('prefers a usable server MIME and flags it; ignores octet-stream', () => {
    const real = describeResult({ job: job('clip.mp4', { resultMime: 'video/mp4' }) });
    expect(real.mime).toBe('video/mp4');
    expect(real.mimeFromServer).toBe(true);
    const octet = describeResult({
      job: job('clip.mp4', { resultMime: 'application/octet-stream' }),
    });
    expect(octet.mime).toBe('video/mp4');
    expect(octet.mimeFromServer).toBe(false);
  });

  it('falls back to the extension MIME table and to octet-stream', () => {
    expect(describeResult({ job: job('a.webp') }).mime).toBe('image/webp');
    expect(describeResult({ job: job('a.qqq') }).mime).toBe('application/octet-stream');
  });

  it('uses the kind hint only when nothing else decides', () => {
    expect(describeResult({ job: job(undefined), kindHint: 'video' }).kind).toBe('video');
    expect(describeResult({ job: job('a.mp3'), kindHint: 'video' }).kind).toBe('audio');
  });

  it('carries job fields and builds a download url', () => {
    const d = describeResult({
      job: job('a.mp4', { resultSizeBytes: 123, expiresAt: '2026-10-24T00:00:00Z' }),
      fallbackFileName: 'ignored.mp4',
    });
    expect(d.jobId).toBe('job-1');
    expect(d.fileName).toBe('a.mp4');
    expect(d.sizeBytes).toBe(123);
    expect(d.expiresAt).toBe('2026-10-24T00:00:00Z');
    expect(d.downloadUrl).toBe(`${API_BASE_URL}/download/job-1`);
  });

  it('uses the fallback file name when the job has none', () => {
    expect(
      describeResult({ job: job(undefined), fallbackFileName: 'x_stitched.mp4' }).fileName,
    ).toBe('x_stitched.mp4');
  });

  it('carries the original ref only when one is given', () => {
    const ref = {
      uri: 'file:///cache/originals/job-1/in.png',
      name: 'in.png',
      mime: 'image/png',
      kind: 'image' as const,
    };
    expect(describeResult({ job: job('a.png'), original: ref }).original).toEqual(ref);
    expect(describeResult({ job: job('a.png') }).original).toBeUndefined();
  });

  it('extensionOf handles tar.gz, case and missing extensions', () => {
    expect(extensionOf('A.TAR.GZ')).toBe('tar.gz');
    expect(extensionOf('a.b.mp4')).toBe('mp4');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf(undefined)).toBe('');
  });

  it('kindOfOriginal reads the MIME type, then the extension', () => {
    expect(kindOfOriginal({ name: 'a.gif', mime: 'image/gif' })).toBe('gif');
    expect(kindOfOriginal({ name: 'a.bin', mime: 'audio/mpeg' })).toBe('audio');
    expect(kindOfOriginal({ name: 'a.srt', mime: '' })).toBe('captions');
    expect(kindOfOriginal(null)).toBe('unknown');
  });
});

describe('archive entry helpers (MM04)', () => {
  it('kindOfFileName classifies entries by extension, never hls/dash', () => {
    expect(kindOfFileName('frames/f1.PNG')).toBe('image');
    expect(kindOfFileName('a/b.mp4')).toBe('video');
    expect(kindOfFileName('master.m3u8')).toBe('metadata');
    expect(kindOfFileName('x.tar.gz')).toBe('archive');
    expect(kindOfFileName('README')).toBe('unknown');
  });
  it('mimeForFileName knows stream parts', () => {
    expect(mimeForFileName('a.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(mimeForFileName('a.mpd')).toBe('application/dash+xml');
    expect(mimeForFileName('s.m4s')).toBe('video/mp4');
    expect(mimeForFileName('s.ts')).toBe('video/mp2t');
  });
});

describe('describe: metadata (MM10)', () => {
  it('inspect_metadata with no file name resolves to the metadata kind', () => {
    expect(describeResult({ job: job(undefined), task: 'inspect_metadata' }).kind).toBe('metadata');
  });
  it('carries metadataAvailable and strippedCount through only when present', () => {
    const d = describeResult({
      job: job('a.jpg', { metadataAvailable: { original: true, result: true }, strippedCount: 7 }),
    });
    expect(d.metadataAvailable).toEqual({ original: true, result: true });
    expect(d.strippedCount).toBe(7);
    const plain = describeResult({ job: job('a.jpg') });
    expect('metadataAvailable' in plain).toBe(false);
    expect('strippedCount' in plain).toBe(false);
  });
});

describe('describe: summary (MM75)', () => {
  it('summarize_video and summarize_audio map to kind summary', () => {
    expect(describeResult({ job: job('summary.md'), task: 'summarize_video' }).kind).toBe(
      'summary',
    );
    expect(describeResult({ job: job('summary.md'), task: 'summarize_audio' }).kind).toBe(
      'summary',
    );
    expect(describeResult({ job: job(undefined), task: 'summarize_audio' }).kind).toBe('summary');
  });
  it('History rows (tool video_summary, mode summarize) are summaries too, with the markdown mime', () => {
    const d = describeResult({
      job: job('clip_summary.md'),
      task: 'video_summary',
      mode: 'summarize',
    });
    expect(d.kind).toBe('summary');
    expect(d.mime).toBe('text/markdown');
    expect(describeResult({ job: job('clip_summary.md'), mode: 'summarize' }).kind).toBe('summary');
  });
});

/** A plausible output file for a registry row, from its default options. */
function plausibleOutput(row: (typeof TOOLS)[number]): { fileName?: string; mode: ResultMode } {
  const d = row.defaults as Record<string, unknown>;
  if (row.webTask === 'extract_frames') return { fileName: 'frames.zip', mode: 'convert' };
  if (row.webTask === 'transcribe_video')
    return { fileName: `out.${d.format ?? 'srt'}`, mode: 'transcribe' };
  if (row.webTask === 'audio_waveform') {
    const w = d.waveform as { outputSelection: string; videoFormat: string; imageFormat: string };
    return {
      fileName: `out.${w.outputSelection === 'video' ? w.videoFormat : w.imageFormat}`,
      mode: 'convert',
    };
  }
  if (row.webTask === 'inspect_metadata') return { fileName: undefined, mode: 'convert' };
  // AI rows that default to no format keep the input's family: images stay PNG, audio WAV.
  const fallback = row.resultHint === 'audio' ? 'wav' : row.resultHint === 'video' ? 'mp4' : 'png';
  const ext = typeof d.format === 'string' ? d.format : fallback;
  return {
    fileName: `out.${ext}`,
    mode:
      row.accepts.kinds.includes('pdf') && !row.accepts.kinds.includes('image')
        ? 'document'
        : 'convert',
  };
}

/** Rows whose default output legitimately differs from `resultHint` (documented). */
const EXCEPTIONS: Record<string, ResultKind> = {
  // The default caption format is VTT, so a finished default run is `captions`; the hint names the family.
  transcribe: 'captions',
};

describe('describe() over the app registry', () => {
  it('covers all 38 rows', () => {
    expect(TOOLS).toHaveLength(38);
  });

  it.each(TOOLS.map((r) => [r.id, r] as const))('%s resolves to its resultHint', (_id, row) => {
    const { fileName, mode } = plausibleOutput(row);
    const kind = describeResult({
      job: job(fileName),
      task: row.webTask,
      mode,
      kindHint: row.resultHint,
    }).kind;
    expect(kind).toBe(EXCEPTIONS[row.id] ?? row.resultHint);
  });

  it('webTask alone (no hint, no file name) never contradicts resultHint', () => {
    for (const row of TOOLS) {
      const kind = describeResult({ job: job(undefined), task: row.webTask }).kind;
      if (kind !== 'unknown') expect(kind).toBe(row.resultHint);
    }
  });

  it('every row names a webTask', () => {
    for (const row of TOOLS) expect(row.webTask).toMatch(/^[a-z0-9_]+$/);
  });
});
