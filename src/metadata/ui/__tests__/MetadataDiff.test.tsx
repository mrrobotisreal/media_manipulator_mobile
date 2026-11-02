import { render, screen, fireEvent } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import jpeg from '../../__fixtures__/inspect-jpeg-gps.json';
import { i18n } from '@/i18n';
import { track } from '@/analytics/track';
import { makeReadyStore } from '@/state/testing';
import { setIdTokenProvider } from '@/api/authToken';
import { metadataDocumentSchema } from '../../types';
import { diffResultSchema } from '../../diffResult';
import { DiffBody, MetadataDiffSheet } from '../MetadataDiffSheet';
import { MetadataResultLine } from '../MetadataResultLine';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('@/ui/components/ProcessingIndicator', () => ({ ProcessingIndicator: () => null }));

const original = metadataDocumentSchema.parse(jpeg);
const gpsLat = original.entries.find((e) => e.id === 'GPS:GPSLatitude')!;
const make = original.entries.find((e) => e.id === 'IFD0:Make')!;
const diff = diffResultSchema.parse({
  removed: [gpsLat, make],
  added: [],
  changed: [{ id: 'File:FileSize', before: '2.1 MB', after: '1.4 MB' }],
  unchanged: 30,
  byCategory: {},
});

const wrap = async (ui: React.ReactElement) => {
  const { store } = await makeReadyStore();
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
};
const fetchOnce = (status: number, body: unknown) => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      status,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  ) as unknown as typeof fetch;
};

beforeEach(() => {
  (track as jest.Mock).mockClear();
  setIdTokenProvider(() => Promise.resolve('tok'));
});

describe('DiffBody', () => {
  it('renders counts, groups removed rows by category and marks expected changes', async () => {
    await render(
      <I18nextProvider i18n={i18n}>
        <DiffBody diff={diff} original={original} />
      </I18nextProvider>,
    );
    expect(screen.getByText('2 removed')).toBeTruthy();
    // File:FileSize is an expected change: counted as unchanged, listed under Changed.
    expect(screen.getByText('0 changed')).toBeTruthy();
    expect(screen.getByTestId('diff-category-gps')).toBeTruthy();
    expect(screen.getByText('expected change')).toBeTruthy();
    // The unchanged filter is off by default; turning it on lists unchanged rows.
    expect(screen.queryByTestId('diff-row-IFD0:Model')).toBeNull();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'unchanged' }));
    expect(screen.getByTestId('diff-row-IFD0:Model')).toBeTruthy();
  });
});

describe('MetadataDiffSheet', () => {
  it('shows "Comparison not available" for a 409 not-comparable', async () => {
    fetchOnce(409, { error: 'Result has no comparable metadata' });
    await wrap(<MetadataDiffSheet jobId="j1" visible onClose={() => undefined} />);
    expect(await screen.findByTestId('diff-unavailable')).toBeTruthy();
    expect(
      screen.getByText('Comparison not available: This result has no comparable metadata'),
    ).toBeTruthy();
  });
});

describe('MetadataResultLine', () => {
  it('renders nothing unless both documents exist', async () => {
    fetchOnce(200, diff);
    await wrap(<MetadataResultLine jobId="j2" available={{ original: true, result: false }} />);
    expect(screen.queryByTestId('metadata-result-line')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows kept/removed, "including location", and Compare fires metadata_diff_opened (buckets only)', async () => {
    fetchOnce(200, diff);
    await wrap(
      <MetadataResultLine
        jobId="j3"
        available={{ original: true, result: true }}
        toolSlug="remove-exif-metadata"
      />,
    );
    expect(await screen.findByText('Metadata: 31 kept · 2 removed')).toBeTruthy();
    expect(screen.getByText('including location')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('metadata-compare'));
    expect((track as jest.Mock).mock.calls.find(([n]) => n === 'metadata_diff_opened')).toEqual([
      'metadata_diff_opened',
      {
        tool: 'remove-exif-metadata',
        removed_bucket: '1-25',
        added_bucket: '0',
        changed_bucket: '1-25',
      },
    ]);
  });

  it('prefers the job strippedCount for the removed number', async () => {
    fetchOnce(200, diff);
    await wrap(
      <MetadataResultLine
        jobId="j4"
        available={{ original: true, result: true }}
        strippedCount={9}
      />,
    );
    expect(await screen.findByText('Metadata: 31 kept · 9 removed')).toBeTruthy();
  });

  it('a failing diff renders nothing', async () => {
    fetchOnce(409, { error: 'Job not completed' });
    await wrap(<MetadataResultLine jobId="j5" available={{ original: true, result: true }} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('metadata-result-line')).toBeNull();
  });
});
