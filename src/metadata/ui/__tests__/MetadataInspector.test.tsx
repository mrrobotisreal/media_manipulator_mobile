import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import jpeg from '../../__fixtures__/inspect-jpeg-gps.json';
import pdf from '../../__fixtures__/inspect-pdf.json';
import { i18n } from '@/i18n';
import { track } from '@/analytics/track';
import { metadataDocumentSchema } from '../../types';
import { documentAsText, MetadataInspector, mapsUrl } from '../MetadataInspector';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

const doc = metadataDocumentSchema.parse(jpeg);
const pdfDoc = metadataDocumentSchema.parse(pdf);
const tracked = () => (track as jest.Mock).mock.calls;

const mount = (d = doc, surface: 'tool_page' | 'result' | 'history' = 'tool_page') =>
  render(
    <I18nextProvider i18n={i18n}>
      <MetadataInspector document={d} surface={surface} />
    </I18nextProvider>,
  );

beforeEach(() => {
  (track as jest.Mock).mockClear();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

describe('MetadataInspector', () => {
  it('renders the summary and the categories in display order', async () => {
    await mount();
    expect(screen.getByTestId('metadata-summary')).toBeTruthy();
    const ids = screen
      .getAllByTestId(/^metadata-section-/)
      .map((n) => n.props.testID.replace('metadata-section-', ''));
    const order = ['file', 'image', 'camera', 'lens', 'gps', 'datetime', 'color', 'thumbnail'];
    const present = ids.filter((i) => order.includes(i));
    expect(present).toEqual(order.filter((i) => ids.includes(i)));
    expect(ids.indexOf('file')).toBeLessThan(ids.indexOf('gps'));
    expect(ids.indexOf('gps')).toBeLessThan(ids.indexOf('xmp'));
  });

  it('the Location privacy chip narrows rows to the GPS entries', async () => {
    await mount();
    expect(screen.getByTestId('metadata-section-camera')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: /^Location \(\d+\)$/ }));
    expect(screen.queryByTestId('metadata-section-camera')).toBeNull();
    expect(screen.getByTestId('metadata-section-gps')).toBeTruthy();
    expect(tracked().filter(([n]) => n === 'metadata_privacy_filter_used')).toEqual([
      ['metadata_privacy_filter_used', { flag: 'location' }],
    ]);
  });

  it('search narrows the rows (debounced) and fires metadata_search_used once with no query', async () => {
    jest.useFakeTimers();
    await mount();
    await fireEvent.changeText(screen.getByTestId('metadata-search'), 'iphone');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.queryByTestId('metadata-section-gps')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('metadata-search'), 'iphone 15');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await fireEvent.changeText(screen.getByTestId('metadata-search'), 'zzzzzz');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('metadata-no-results')).toBeTruthy();
    expect(tracked().filter(([n]) => n === 'metadata_search_used')).toEqual([
      ['metadata_search_used', {}],
    ]);
    jest.useRealTimers();
  });

  it('GPS card shows decimal and DMS and makes no network call', async () => {
    await mount();
    expect(screen.getByTestId('gps-decimal').props.children).toMatch(/48\.85/);
    expect(screen.getByTestId('gps-dms').props.children).toMatch(/°/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('builds a geo: link on Android and maps:// on iOS only for the tap', () => {
    expect(mapsUrl(48.858222, 2.2945, 'android')).toBe(
      'geo:48.858222,2.294500?q=48.858222,2.294500',
    );
    expect(mapsUrl(48.858222, 2.2945, 'ios')).toBe('maps://?ll=48.858222,2.294500');
  });

  it('a document without GPS shows no location card; a PDF renders', async () => {
    await mount(pdfDoc);
    expect(screen.queryByTestId('metadata-gps-card')).toBeNull();
    expect(screen.getByTestId('metadata-section-pdf')).toBeTruthy();
  });

  it('toggling a section fires metadata_section_toggled with a category id', async () => {
    await mount();
    await fireEvent.press(screen.getByRole('button', { name: /Camera and exposure/ }));
    const call = tracked().find(([n]) => n === 'metadata_section_toggled');
    expect(call?.[1]).toMatchObject({ category: 'camera' });
    expect(typeof call?.[1].open).toBe('boolean');
  });

  it('fires metadata_inspected once per document per surface, with bucketed props only', async () => {
    const fresh = metadataDocumentSchema.parse(jpeg);
    const el = (surface: 'tool_page' | 'result') => (
      <I18nextProvider i18n={i18n}>
        <MetadataInspector document={fresh} surface={surface} />
      </I18nextProvider>
    );
    const { rerender } = await render(el('tool_page'));
    rerender(el('tool_page'));
    expect(tracked().filter(([n]) => n === 'metadata_inspected')).toEqual([
      [
        'metadata_inspected',
        {
          surface: 'tool_page',
          kind: 'image',
          tag_bucket: '26-100',
          has_gps: true,
          has_c2pa: false,
        },
      ],
    ]);
    await render(el('result'));
    expect(tracked().filter(([n]) => n === 'metadata_inspected')).toHaveLength(2);
  });

  it('documentAsText lists group:tag = value lines', () => {
    expect(
      documentAsText([{ entry: { group: 'IFD0', tag: 'Make' }, text: 'Apple' } as never]),
    ).toBe('IFD0:Make = Apple');
  });
});
