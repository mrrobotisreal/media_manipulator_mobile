import {
  FLAC_RATIO,
  WAV_HINT_BYTES,
  effectiveStemFormat,
  estimateStemBytes,
  isStemFormatChoice,
  isStemOperation,
  resolveStemFormat,
  stemOutputFormat,
  wavNeedsHint,
} from '../stemFormat';

const MB = 1024 * 1024;
const EIGHTY_SEVEN_MIN = 87 * 60;

describe('MM81 stem format: default follows the input (port of the web test)', () => {
  it.each([
    ['song.mp3', 'audio/mpeg', 'mp3'],
    ['song.m4a', 'audio/x-m4a', 'm4a'],
    ['song.aac', 'audio/aac', 'aac'],
    ['song.ogg', 'audio/ogg', 'ogg'],
    ['song.opus', 'audio/ogg', 'opus'],
    ['song.wav', 'audio/wav', 'flac'],
    ['song.flac', 'audio/flac', 'flac'],
    ['song.aiff', 'audio/aiff', 'flac'],
    ['clip.mp4', 'video/mp4', 'mp3'],
    ['clip.mov', 'video/quicktime', 'mp3'],
    ['noext', 'audio/flac', 'flac'],
    ['noext', '', 'mp3'],
  ])('%s (%s) -> %s', (name, mime, want) => {
    expect(resolveStemFormat(name, mime)).toBe(want);
  });

  it('a choice overrides the input; auto resolves', () => {
    expect(effectiveStemFormat('auto', 'a.mp3')).toBe('mp3');
    expect(effectiveStemFormat('wav', 'a.mp3')).toBe('wav');
    expect(effectiveStemFormat('flac', 'a.mp3')).toBe('flac');
    expect(effectiveStemFormat('mp3', 'a.wav')).toBe('mp3');
  });

  it('the output format prefers what the API resolved', () => {
    expect(stemOutputFormat('auto', 'a.m4a', 'audio/mp4', { format: 'flac' })).toBe('flac');
    expect(stemOutputFormat('auto', 'a.mp3', 'audio/mpeg', { format: 'auto' })).toBe('mp3');
    expect(stemOutputFormat('auto', 'a.mp3', 'audio/mpeg')).toBe('mp3');
    expect(stemOutputFormat('wav', 'a.mp3', 'audio/mpeg')).toBe('wav');
  });

  it('guards', () => {
    expect(isStemOperation('remove_vocals') && isStemOperation('isolate_vocals')).toBe(true);
    expect(isStemOperation('clean_voice') || isStemOperation(undefined)).toBe(false);
    expect(['auto', 'mp3', 'flac', 'wav'].every(isStemFormatChoice)).toBe(true);
    expect(isStemFormatChoice('ogg')).toBe(false);
  });
});

describe('MM81 stem size estimates (port)', () => {
  it('87-minute song: about 199 MB MP3, 484 MB FLAC, 878 MB WAV (with the hint)', () => {
    const wav = estimateStemBytes('wav', EIGHTY_SEVEN_MIN)!;
    const flac = estimateStemBytes('flac', EIGHTY_SEVEN_MIN)!;
    const mp3 = estimateStemBytes('mp3', EIGHTY_SEVEN_MIN)!;
    expect(wav).toBe(44_100 * 2 * 2 * EIGHTY_SEVEN_MIN);
    expect(Math.round(wav / MB)).toBe(878);
    expect(Math.round(flac / MB)).toBe(483);
    expect(Math.round(mp3 / MB)).toBe(199);
    expect(flac).toBe(Math.round(wav * FLAC_RATIO));
    expect(wavNeedsHint(wav)).toBe(true);
    expect(wavNeedsHint(flac)).toBe(false);
  });

  it('matches the real incident within 1 %', () => {
    const real = 922_710_094;
    const est = estimateStemBytes('wav', real / (44_100 * 4))!;
    expect(Math.abs(est - real) / real).toBeLessThan(0.01);
  });

  it('lossy formats use their constant bitrate', () => {
    expect(estimateStemBytes('mp3', 60)).toBe(40_000 * 60);
    expect(estimateStemBytes('m4a', 60)).toBe(40_000 * 60);
    expect(estimateStemBytes('ogg', 60)).toBe(24_000 * 60);
    expect(estimateStemBytes('opus', 60)).toBe(16_000 * 60);
  });

  it('no estimate without a duration', () => {
    for (const d of [null, undefined, 0, -1, Number.NaN])
      expect(estimateStemBytes('wav', d)).toBeNull();
  });

  it('the WAV hint starts above 500 MB', () => {
    expect(wavNeedsHint(WAV_HINT_BYTES)).toBe(false);
    expect(wavNeedsHint(WAV_HINT_BYTES + 1)).toBe(true);
    expect(wavNeedsHint(null)).toBe(false);
    expect(wavNeedsHint(estimateStemBytes('wav', 49 * 60))).toBe(false);
    expect(wavNeedsHint(estimateStemBytes('wav', 51 * 60))).toBe(true);
  });
});
