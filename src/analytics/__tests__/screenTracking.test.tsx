import { render } from '@testing-library/react-native';
import { EVENTS } from '../events';
import { screenPattern, useScreenTracking } from '../useScreenTracking';

let mockSegments: string[] = [];
jest.mock('expo-router', () => ({
  usePathname: () => `/${mockSegments.join('/')}`,
  useSegments: () => mockSegments,
}));

describe('screenPattern', () => {
  it.each([
    [['(app)', '(tabs)'], '/tools'],
    [['(app)', '(tabs)', 'index'], '/tools'],
    [['(app)', '(tabs)', 'history'], '/history'],
    [['(app)', '(tabs)', 'account'], '/account'],
    [['(app)', 'tool', '[family]', '[toolId]'], '/tool/[family]/[toolId]'],
    [['(app)', 'job', '[jobId]'], '/job/[jobId]'],
    [['(auth)', 'sign-in'], '/sign-in'],
  ])('%j -> %s', (segments, pattern) => {
    expect(screenPattern(segments)).toBe(pattern);
  });
});

function Probe({ track }: { track: jest.Mock }) {
  useScreenTracking(track);
  return null;
}

describe('useScreenTracking', () => {
  it('emits once per distinct consecutive pattern, never concrete ids', async () => {
    const track = jest.fn();
    mockSegments = ['(app)', '(tabs)'];
    const r = await render(<Probe track={track} />);
    mockSegments = ['(app)', 'tool', '[family]', '[toolId]'];
    await r.rerender(<Probe track={track} />);
    await r.rerender(<Probe track={track} />); // same pattern (another tool): no repeat
    mockSegments = ['(app)', '(tabs)', 'history'];
    await r.rerender(<Probe track={track} />);
    expect(track.mock.calls).toEqual([
      [EVENTS.SCREEN_VIEWED, { screen: '/tools' }],
      [EVENTS.SCREEN_VIEWED, { screen: '/tool/[family]/[toolId]' }],
      [EVENTS.SCREEN_VIEWED, { screen: '/history' }],
    ]);
  });
});
