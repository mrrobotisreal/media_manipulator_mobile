import { audioFadeGain } from '../../../previewEngine';
import { applyVolume, PREVIEW_AUDIO_NOTE, slotVolume, slotVolumes, type VolumeSlot } from '../AudioVolumes';
import { clip, lane } from '../testing/sim';

const slot = (over: Partial<VolumeSlot> & { clip: VolumeSlot['clip']; trackId: string }): VolumeSlot => ({
  active: true,
  stalled: false,
  ...over,
});

describe('AudioVolumes: clip volume x keyframes x fades x track gain x mute/solo x master', () => {
  const a = clip({ id: 'a', timelineStart: 0, sourceIn: 0, sourceOut: 4, volume: 0.8 });
  const v1 = lane('v1', 0, [a], { gain: 0.5 });
  const ctx = (over = {}) => ({ tracks: [v1], audio: { masterGain: 0.9 } as never, t: 1, ...over });

  it('multiplies clip x track x master', () => {
    expect(slotVolume(slot({ clip: a, trackId: 'v1' }), ctx())).toBeCloseTo(0.8 * 0.5 * 0.9, 9);
  });

  it('caps at 1 (a player cannot boost)', () => {
    const loud = clip({ id: 'l', timelineStart: 0, sourceOut: 4, volume: 2 });
    const tr = lane('v1', 0, [loud], { gain: 2 });
    expect(slotVolume(slot({ clip: loud, trackId: 'v1' }), { tracks: [tr], audio: undefined, t: 1 })).toBe(1);
  });

  it('follows the v3 volume keyframes (eased lane) over the flat volume', () => {
    const k = clip({
      id: 'k',
      timelineStart: 2,
      sourceOut: 4,
      volume: 1,
      keyframes: { volume: [{ t: 0, value: 0, ease: 'linear' }, { t: 2, value: 1, ease: 'linear' }] },
    } as never);
    const tr = lane('v1', 0, [k]);
    const at = (t: number) => slotVolume(slot({ clip: k, trackId: 'v1' }), { tracks: [tr], audio: undefined, t });
    expect(at(2)).toBeCloseTo(0, 6);
    expect(at(4)).toBeCloseTo(1, 6);
    expect(at(3)).toBeGreaterThan(0);
    expect(at(3)).toBeLessThan(1);
  });

  it('applies the equal-power crossfade from the copied audioFadeGain', () => {
    const p = clip({ id: 'p', timelineStart: 0, sourceOut: 4 });
    const n = clip({ id: 'n', timelineStart: 3, sourceOut: 4 });
    const tr = lane('a1', 0, [p, n], { kind: 'audio' });
    for (const t of [3.1, 3.5, 3.9]) {
      const c = { tracks: [tr], audio: undefined, t };
      expect(slotVolume(slot({ clip: p, trackId: 'a1' }), c)).toBeCloseTo(audioFadeGain(p, tr.clips, t), 9);
      expect(slotVolume(slot({ clip: n, trackId: 'a1' }), c)).toBeCloseTo(audioFadeGain(n, tr.clips, t), 9);
    }
  });

  it('mute and solo follow trackAudibility (solo beats mute; solo silences video audio)', () => {
    const va = clip({ id: 'va', timelineStart: 0, sourceOut: 4 });
    const aa = clip({ id: 'aa', timelineStart: 0, sourceOut: 4, assetId: 'a2' });
    const vt = lane('v1', 0, [va]);
    const at = lane('a1', 0, [aa], { kind: 'audio', solo: true, muted: true });
    const vols = slotVolumes(
      [slot({ clip: va, trackId: 'v1' }), slot({ clip: aa, trackId: 'a1' })],
      { tracks: [vt, at], audio: undefined, t: 1 },
    );
    expect(vols).toEqual([0, 1]);
    const muted = lane('v1', 0, [va], { muted: true });
    expect(slotVolume(slot({ clip: va, trackId: 'v1' }), { tracks: [muted], audio: undefined, t: 1 })).toBe(0);
  });

  it('stepped / held, pre-roll and retained slots are silent', () => {
    expect(slotVolume(slot({ clip: a, trackId: 'v1', stalled: true }), ctx())).toBe(0);
    expect(slotVolume(slot({ clip: a, trackId: 'v1', active: false }), ctx())).toBe(0);
    expect(slotVolume(slot({ clip: null, trackId: 'v1' }), ctx())).toBe(0);
  });

  it('EQ, compressor, pan and ducking are not previewed (the mixer says so)', () => {
    const fx = lane('v1', 0, [a], {
      gain: 0.5,
      pan: -1,
      effects: { eq: { lowGainDb: 12, midGainDb: 12, highGainDb: 12 } },
    } as never);
    expect(slotVolume(slot({ clip: a, trackId: 'v1' }), { ...ctx(), tracks: [fx] })).toBeCloseTo(0.8 * 0.5 * 0.9, 9);
    expect(PREVIEW_AUDIO_NOTE).toBe(true);
  });

  it('applyVolume writes only real changes', () => {
    const p = { volume: 0.5 };
    expect(applyVolume(p, 0.501)).toBe(false);
    expect(applyVolume(p, 0.6)).toBe(true);
    expect(p.volume).toBe(0.6);
    const q = { volume: 0.001 };
    expect(applyVolume(q, 0)).toBe(true);
    expect(q.volume).toBe(0);
  });
});
