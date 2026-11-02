import { render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import {
  ADJUST_DEFAULTS,
  TRANSFORM_DEFAULTS,
  adjustValid,
  transformValid,
  TRIM_DEFAULTS,
  trimRangeValid,
} from '../../../options/video';
import { VideoAdjustForm } from '../AdjustForm';
import { VideoTransformForm } from '../TransformForm';
import { VideoTrimForm } from '../TrimForm';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn(), setContext: jest.fn() }));
jest.mock('../../../native/TrimRangeScrubber', () => ({
  TrimRangeScrubber: () => null,
  FramePicker: () => null,
}));
jest.mock('../../../native/useScrubPlayer', () => ({ useScrubPlayer: () => ({}) }));
jest.mock('../../../native/useVideoThumbnails', () => ({ useVideoFrame: () => null }));

async function wrap(node: React.ReactElement) {
  const { store } = await makeReadyStore();
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </Provider>,
  );
}

describe('VideoTransformForm resize gate', () => {
  const ctx = { limits: { maxOutputHeight: 720 } };
  function Host({ init }: { init: typeof TRANSFORM_DEFAULTS }) {
    const [v, setV] = useState(init);
    return <VideoTransformForm value={v} onChange={setV} ctx={ctx} />;
  }
  it('flags height 2000 on the free cap and keeps width-only 3840 valid', async () => {
    expect(transformValid({ ...TRANSFORM_DEFAULTS, height: 2000 }, ctx)).toBe(false);
    expect(transformValid({ ...TRANSFORM_DEFAULTS, width: 3840 }, ctx)).toBe(true);
    await wrap(<Host init={{ ...TRANSFORM_DEFAULTS, height: 2000 }} />);
    expect(screen.getByText(/720p/)).toBeTruthy();
  });
  it('shows no hint for width-only', async () => {
    await wrap(<Host init={{ ...TRANSFORM_DEFAULTS, width: 3840 }} />);
    expect(screen.queryByText(/720p/)).toBeNull();
  });
});

describe('VideoAdjustForm colour', () => {
  it('with all defaults is invalid and says so; a change makes it valid', async () => {
    const color = { ...ADJUST_DEFAULTS, adjust: 'color' as const };
    expect(adjustValid(color)).toBe(false);
    await wrap(<VideoAdjustForm value={color} onChange={() => undefined} />);
    expect(screen.getByText('Change at least one slider')).toBeTruthy();
    expect(adjustValid({ ...color, brightness: 5 })).toBe(true);
  });
});

describe('VideoTrimForm', () => {
  it('rejects a 0.05 s range with the invalid-range message', async () => {
    expect(trimRangeValid(1, 1.05)).toBe(false);
    await wrap(
      <VideoTrimForm
        value={{ ...TRIM_DEFAULTS, start: 1, end: 1.05 }}
        onChange={() => undefined}
        ctx={{
          input: {
            name: 'a.mp4',
            extension: 'mp4',
            mime: 'video/mp4',
            mediaKind: 'video',
            uri: 'file:///a.mp4',
            durationSec: 10,
          },
        }}
      />,
    );
    expect(screen.getByText('Set an end time later than the start time.')).toBeTruthy();
  });
});
