import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import jpeg from '@/metadata/__fixtures__/inspect-jpeg-gps.json';
import { i18n } from '@/i18n';
import { resetInspectCacheForTests, setInspectDeps } from '@/metadata/useInspect';
import type { MakeTaskOptions } from '@/jobs/transport';
import { TOOL_BY_ID, type ToolContext } from '../../../registry';
import { EDIT_DEFAULTS } from '../../../options/metadata';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

const calls: { url: string; opts: MakeTaskOptions }[] = [];
beforeEach(() => {
  calls.length = 0;
  mockPush.mockClear();
  resetInspectCacheForTests();
  setInspectDeps({
    buildHeaders: () => Promise.resolve({}),
    baseUrl: 'https://api.test/api',
    makeTask: (_uri, url, opts) => {
      calls.push({ url, opts });
      return {
        cancel: jest.fn(),
        uploadAsync: () =>
          Promise.resolve({ status: 200, headers: {}, body: JSON.stringify(jpeg) }),
      };
    },
  });
});
afterAll(() => setInspectDeps(null));

const ctx = (extension: string, mediaKind: 'image' | 'video' | 'audio' | 'pdf'): ToolContext => ({
  input: {
    id: `i-${extension}`,
    sizeBytes: 1000,
    name: `photo.${extension}`,
    uri: `file:///c/photo.${extension}`,
    extension,
    mime: 'image/jpeg',
    mediaKind,
  },
});
const mount = (
  id: string,
  c: ToolContext,
  value?: Record<string, unknown>,
  onChange = jest.fn(),
) => {
  const tool = TOOL_BY_ID.get(id)!;
  const { Form } = tool;
  return render(
    <I18nextProvider i18n={i18n}>
      <Form value={value ?? tool.defaults} onChange={onChange} ctx={c} />
    </I18nextProvider>,
  );
};

describe('StripMetadataFlow', () => {
  it('shows the inspect result, then submits the golden options', async () => {
    const c = ctx('jpeg', 'image');
    await mount('strip-metadata', c);
    expect(await screen.findByTestId('metadata-inspector')).toBeTruthy();
    expect(
      screen.getByText(
        'This is what the file carries today. Strip everything removes it all and keeps the same format.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('strip-format-note')).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.test/api/metadata/inspect');
    const tool = TOOL_BY_ID.get('strip-metadata')!;
    expect(tool.optionsBuilder(tool.defaults, c)).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'strip',
    });
  });
});

describe('InspectMetadataFlow', () => {
  it('auto-inspects, offers Strip everything and Edit for an image, and never runs a job', async () => {
    const c = ctx('jpg', 'image');
    await mount('inspect-metadata', c);
    expect(await screen.findByTestId('metadata-inspector')).toBeTruthy();
    expect(TOOL_BY_ID.get('inspect-metadata')!.noRunButton).toBe(true);
    await fireEvent.press(screen.getByTestId('inspect-strip'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/tool/metadata/strip-metadata?intake=i-jpg');
    expect(screen.getByTestId('inspect-edit')).toBeTruthy();
  });
  it('offers no edit for video and nothing for a PDF', async () => {
    await mount('inspect-metadata', ctx('mp4', 'video'));
    await screen.findByTestId('metadata-inspector');
    expect(screen.queryByTestId('inspect-edit')).toBeNull();
    expect(screen.getByTestId('inspect-strip')).toBeTruthy();
  });
  it('a pdf has no strip action', async () => {
    await mount('inspect-metadata', ctx('pdf', 'pdf'));
    await screen.findByTestId('metadata-inspector');
    expect(screen.queryByTestId('inspect-strip')).toBeNull();
  });
  it('an inspect failure shows a retry', async () => {
    setInspectDeps({
      buildHeaders: () => Promise.resolve({}),
      makeTask: () => ({
        cancel: jest.fn(),
        uploadAsync: () =>
          Promise.resolve({ status: 400, headers: {}, body: '{"error":"no file provided"}' }),
      }),
    });
    await mount('inspect-metadata', ctx('jpg', 'image'));
    expect(await screen.findByTestId('inspect-error')).toBeTruthy();
  });
});

describe('EditMetadataFlow', () => {
  it('prefills text fields and coordinates from the inspected document', async () => {
    const onChange = jest.fn();
    await mount('edit-metadata', ctx('jpg', 'image'), EDIT_DEFAULTS, onChange);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      latitude: '48.858222',
      longitude: '2.2945',
    });
  });
  it('replace shows coordinate inputs and blocks an out-of-range latitude', async () => {
    const tool = TOOL_BY_ID.get('edit-metadata')!;
    const value = { ...EDIT_DEFAULTS, location: 'replace', latitude: '99', longitude: '2' };
    await mount('edit-metadata', ctx('jpg', 'image'), value);
    expect(screen.getByTestId('edit-latitude')).toBeTruthy();
    expect(screen.getByTestId('edit-invalid')).toBeTruthy();
    expect(tool.blockReason?.(value)).toBe('invalidLocation');
    expect(tool.blockReason?.({ ...value, latitude: '45' })).toBeNull();
  });
});
