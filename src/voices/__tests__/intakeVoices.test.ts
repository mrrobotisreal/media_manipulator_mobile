import { toolsForKinds } from '@/files/intakeTools';
import { TOOL_BY_ID } from '@/tools/registry';

describe('Voices rows in share-into / intake (MA34 decision 1)', () => {
  it('shared audio offers the shifter, the converter and cloning, never the designer (it takes no file)', () => {
    const ids = toolsForKinds(['audio'], []).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['voice-shift', 'voice-change', 'voice-clone']));
    expect(ids).not.toContain('voice-design');
  });
  it('images and videos are never offered a Voices tool', () => {
    for (const k of ['image', 'video'] as const)
      expect(toolsForKinds([k], []).some((t) => t.family === 'voices')).toBe(false);
  });
  it('the Voices rows own their input (no Run button for clone / design, the file area for change / shift)', () => {
    expect(TOOL_BY_ID.get('voice-clone')!.noRunButton).toBe(true);
    expect(TOOL_BY_ID.get('voice-design')!.noFileArea).toBe(true);
    expect(TOOL_BY_ID.get('voice-change')!.starter).toBe('voiceConvert');
    expect(TOOL_BY_ID.get('voice-shift')!.starter).toBe('voiceShift');
  });
});
