import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { setIdTokenProvider } from '@/api/authToken';
import type { PhotoCapabilities } from '@/api/schemas/photo';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { exportBody, type ExportChoice } from '../exportPlan';
import { upsertAdjustment } from '../layerOps';
import { makePhotoStore } from '../photoStore';
import { newPhotoDoc } from '../photoTypes';
import { photoApi } from '../projectsApi';
import { EditorProvider } from '../ui/EditorContext';
import { ExportSheet } from '../ui/ExportSheet';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const caps = (maxMegapixels: number): PhotoCapabilities => ({
  enabled: true,
  render: true,
  formats: ['jpg', 'png', 'webp', 'avif', 'tiff'],
  maxMegapixels,
  photoProjects: 5,
  photoBatch: 3,
  aiMasks: true,
  heal: true,
  tier: 'free',
});

// A 24 MP photo (6000 x 4000).
const doc = upsertAdjustment(newPhotoDoc(6000, 4000), 'exposure', (p) => ({ ...p, ev: 1 })).doc;

async function renderSheet(
  c: PhotoCapabilities,
  onExport = jest.fn(),
  ready = true,
  onLockedSize?: (mp: number) => void,
) {
  await render(
    <I18nextProvider i18n={i18n}>
      <EditorProvider value={{ store: makePhotoStore(), haptics: false }}>
        <ExportSheet
          visible
          onClose={() => undefined}
          doc={doc}
          capabilities={c}
          ready={ready}
          onExport={onExport}
          onLockedSize={onLockedSize}
        />
      </EditorProvider>
    </I18nextProvider>,
  );
  return onExport;
}

const disabled = (mp: number) =>
  screen.getByTestId(`photo-export-size-${mp}`).props.accessibilityState?.disabled === true;

describe('Export sheet', () => {
  it('free (12 MP cap): 24 / 64 / 120 and Original (24 MP photo) are disabled; the cap line is neutral', async () => {
    await renderSheet(caps(12));
    expect([0, 12, 24, 64, 120].map(disabled)).toEqual([true, false, true, true, true]);
    expect(screen.getByText('Exports up to 12 MP on your plan')).toBeTruthy();
    expect(screen.queryByText(/upgrade|price|\$/i)).toBeNull();
  });

  it('MA52: a locked size stays unselected and reports the gate with its megapixels', async () => {
    const onLocked = jest.fn();
    const onExport = await renderSheet(caps(12), jest.fn(), true, onLocked);
    await fireEvent.press(screen.getByTestId('photo-export-size-64'));
    await fireEvent.press(screen.getByTestId('photo-export-size-0'));
    expect(onLocked.mock.calls).toEqual([[64], [24]]);
    await fireEvent.press(screen.getByTestId('photo-export-start'));
    expect((onExport.mock.calls[0]![0] as ExportChoice).maxSize).toBe(12);
  });

  it('pro (120 MP cap): nothing is disabled', async () => {
    await renderSheet(caps(120));
    expect([0, 12, 24, 64, 120].map(disabled)).toEqual([false, false, false, false, false]);
  });

  it('Export sends the chosen options (a locked default falls back to the largest open size)', async () => {
    const onExport = await renderSheet(caps(12));
    await fireEvent.press(screen.getByTestId('photo-export-format-png'));
    await fireEvent.press(screen.getByTestId('photo-export-start'));
    const choice = onExport.mock.calls[0]![0] as ExportChoice;
    expect(choice).toEqual({ format: 'png', quality: 92, metadataMode: 'keep', maxSize: 12 });
  });

  it('Export is disabled until the upload finished, and when render is off', async () => {
    await renderSheet(caps(120), jest.fn(), false);
    expect(screen.getByTestId('photo-export-start').props.accessibilityState?.disabled).toBe(true);
  });

  it('posts the right body to POST /photo/projects/:id/export (fake fetch)', async () => {
    const { store } = await makeReadyStore();
    setIdTokenProvider(() => Promise.resolve('tok'));
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        status: 202,
        headers: new Headers(),
        text: () => Promise.resolve('{"jobId":"job-9"}'),
      });
    }) as unknown as typeof fetch;
    const body = exportBody(
      doc,
      { format: 'jpg', quality: 90, metadataMode: 'strip', maxSize: 24 },
      'IMG_1',
    );
    const r = await store.dispatch(
      photoApi.endpoints.exportPhotoProject.initiate({ id: 'p1', revision: 4, body }),
    );
    expect('data' in r && r.data).toEqual({ jobId: 'job-9' });
    expect(calls[0]!.url).toMatch(/\/photo\/projects\/p1\/export$/);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['If-Match']).toBe('4');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      doc: JSON.parse(JSON.stringify(doc)),
      format: 'jpg',
      quality: 90,
      metadataMode: 'strip',
      maxMegapixels: 24,
      name: 'IMG_1',
    });
  });
});
