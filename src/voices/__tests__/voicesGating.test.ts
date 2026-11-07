import { TOOL_BY_ID, TOOLS } from '@/tools/registry';
import { isToolAvailable, type Capabilities } from '@/tools/availability';
import { isVoiceCapabilityMet } from '../gating';

const limits = (over: Partial<{ voicesSaved: number; voicesConvert: boolean }> = {}) => ({
  voicesSaved: 1,
  voicesMaxSeconds: 60,
  voicesConvert: true,
  voicesConvertMaxSeconds: 60,
  textMaxChars: 1080,
  ...over,
});
const caps = (enabled: boolean, over = {}): Capabilities => ({
  voices: { enabled, limits: limits(over) },
});

const visible = (c: Capabilities) =>
  TOOLS.filter((t) => t.family === 'voices' && isToolAvailable(t, c)).map((t) => t.id);

describe('Voices gating (MA34 decision 1)', () => {
  it('has the four rows in the voices family, in the documented order', () => {
    expect(TOOLS.filter((t) => t.family === 'voices').map((t) => t.id)).toEqual([
      'voice-clone',
      'voice-design',
      'voice-change',
      'voice-shift',
    ]);
  });

  it('enabled:false -> only the shifter shows', () => {
    expect(visible(caps(false))).toEqual(['voice-shift']);
  });

  it('the capabilities call failed or is loading (undefined) -> no Voices row at all', () => {
    expect(visible({})).toEqual([]);
    expect(visible({ voices: undefined })).toEqual([]);
  });

  it('enabled with a Pro-like plan -> all four rows', () => {
    expect(visible(caps(true, { voicesSaved: 25 }))).toEqual([
      'voice-clone',
      'voice-design',
      'voice-change',
      'voice-shift',
    ]);
  });

  it('voicesSaved 0 hides clone and design; unlimited (-1) shows them', () => {
    expect(visible(caps(true, { voicesSaved: 0 }))).toEqual(['voice-change', 'voice-shift']);
    expect(visible(caps(true, { voicesSaved: -1 }))).toContain('voice-clone');
  });

  it('voicesConvert false hides change only', () => {
    expect(visible(caps(true, { voicesConvert: false }))).toEqual([
      'voice-clone',
      'voice-design',
      'voice-shift',
    ]);
  });

  it('the anonymous tier (production 2026-11-07: enabled, voicesSaved 0, no convert) shows the shifter only', () => {
    expect(visible(caps(true, { voicesSaved: 0, voicesConvert: false }))).toEqual(['voice-shift']);
  });

  it('non-voice rows are unaffected by the voices capabilities', () => {
    expect(isToolAvailable(TOOL_BY_ID.get('image-convert')!, {})).toBe(true);
    expect(isVoiceCapabilityMet('voiceShift', undefined)).toBe(false);
  });

  it('shows no Voices row in share-into / intake for a design tool (it takes no file)', () => {
    expect(TOOL_BY_ID.get('voice-design')!.noIntake).toBe(true);
  });

  it('metrics: clone / design / change are ai_ops, shift is ops (the API quota rows)', () => {
    expect(
      ['voice-clone', 'voice-design', 'voice-change', 'voice-shift'].map(
        (id) => TOOL_BY_ID.get(id)!.metric,
      ),
    ).toEqual(['ai_ops', 'ai_ops', 'ai_ops', 'ops']);
  });
});
