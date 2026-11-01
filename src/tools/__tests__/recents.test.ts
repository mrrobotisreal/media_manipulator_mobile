import reducer, { MAX_RECENT_TOOLS, pushRecentTool, toolOpened } from '@/state/slices/settings';
import { recentTools } from '../recents';

describe('recents', () => {
  it('puts the newest first and de-duplicates', () => {
    expect(pushRecentTool(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });
  it('caps at 6', () => {
    let l: string[] = [];
    for (const id of ['1', '2', '3', '4', '5', '6', '7']) l = pushRecentTool(l, id);
    expect(l).toHaveLength(MAX_RECENT_TOOLS);
    expect(l[0]).toBe('7');
    expect(l).not.toContain('1');
  });
  it('the reducer records toolOpened', () => {
    const s0 = reducer(undefined, { type: '@@init' });
    const s1 = reducer(reducer(s0, toolOpened('image-resize')), toolOpened('transcribe'));
    expect(s1.lastToolIds).toEqual(['transcribe', 'image-resize']);
  });
  it('drops unknown ids on read', () => {
    expect(recentTools(['nope', 'image-resize', 'image-resize']).map((t) => t.id)).toEqual([
      'image-resize',
    ]);
  });
});
