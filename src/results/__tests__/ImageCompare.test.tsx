import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { track } from '@/analytics/track';
import { resetResultAnalyticsForTests } from '@/analytics/resultEvents';
import { i18n } from '@/i18n';
import { ImageCompare } from '../compare/ImageCompare';
import type { ResultDescriptor } from '../describe';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: class {
    get size() {
      return 1000;
    }
  },
}));
jest.mock('../ZoomContainer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require('react-native');
  return {
    useZoomState: () => ({}),
    ZoomContainer: ({ children, onTap }: { children: unknown; onTap?: () => void }) => (
      <Pressable testID="zoom-tap" onPress={onTap}>
        {children}
      </Pressable>
    ),
  };
});
jest.mock('../Checkerboard', () => ({ Checkerboard: () => null }));

const descriptor = {
  kind: 'image',
  mime: 'image/png',
  fileName: 'out.png',
  jobId: 'job-1',
  downloadUrl: '',
  mimeFromServer: false,
  sizeBytes: 380,
  original: { uri: 'file:///cache/originals/job-1/in.jpg', name: 'in.jpg', kind: 'image' },
} as ResultDescriptor;

const renderCompare = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ImageCompare
        descriptor={descriptor}
        context={{ jobId: 'job-1', toolSlug: 'image-converter', mediaKind: 'image' }}
        resultUri="file:///cache/results/job-1/out.png"
        resultBytes={380}
        zoom={{} as never}
      />
    </I18nextProvider>,
  );

const compareCalls = () =>
  (track as jest.Mock).mock.calls.filter(([n]) => n === 'result_compare_used');

beforeEach(() => {
  (track as jest.Mock).mockClear();
  resetResultAnalyticsForTests();
});

describe('ImageCompare', () => {
  it('starts in wipe (emits once), shows the size delta, and mode switches emit once per mode', async () => {
    await renderCompare();
    expect(compareCalls()).toHaveLength(1);
    expect(compareCalls()[0][1]).toEqual({ job_id: 'job-1', kind: 'image', mode: 'wipe' });
    expect(screen.getByText('−62% vs original')).toBeTruthy();
    expect(screen.getByTestId('compare-handle')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Toggle' }));
    expect(compareCalls()).toHaveLength(2);
    expect(compareCalls()[1][1]).toMatchObject({ mode: 'toggle' });
    expect(screen.queryByTestId('compare-handle')).toBeNull();

    // Back and forth never re-emits a mode already used.
    await fireEvent.press(screen.getByRole('tab', { name: 'Wipe' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Toggle' }));
    expect(compareCalls()).toHaveLength(2);
  });

  it('toggle mode flips the label chip between Original and Result on tap', async () => {
    await renderCompare();
    await fireEvent.press(screen.getByRole('tab', { name: 'Toggle' }));
    expect(screen.getByText('Original')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('zoom-tap'));
    expect(screen.getByText('Result')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('zoom-tap'));
    expect(screen.getByText('Original')).toBeTruthy();
  });
});
