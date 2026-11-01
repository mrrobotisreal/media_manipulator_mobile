import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { accountApi } from '@/api/endpoints/account';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { getTool } from '@/tools/registry';
import { track } from '@/analytics/track';
import { FileArea } from '../components/FileArea';

jest.mock('expo-file-system', () => ({
  File: class {},
  Directory: class {},
  Paths: { cache: {}, availableDiskSpace: 1e12 },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../duration', () => ({ probeDuration: jest.fn(async () => undefined) }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));
jest.mock('@/analytics/track', () => {
  const actual = jest.requireActual('@/analytics/track');
  return { ...actual, track: jest.fn() };
});
const mockImage = jest.fn();
const mockDoc = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (o: unknown) => mockImage(o) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (o: unknown) => mockDoc(o) }));

const limits = {
  opsPerDay: 5,
  aiOpsPerDay: 1,
  exportsPerDay: 1,
  maxFileBytes: 100 * 1024 * 1024,
  maxVideoSeconds: 1200,
  maxOutputHeight: 1080,
  priorityGpu: false,
  resultRetentionHours: 24,
  adsRemoved: false,
};

async function press(el: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    await fireEvent.press(el);
  });
}

async function setup(toolId: string, withLimits = true) {
  const { store } = await makeReadyStore();
  if (withLimits) {
    await store.dispatch(
      accountApi.util.upsertQueryData('getAccountMe', undefined, {
        tier: 'free',
        limits,
        usage: {},
        resetsAt: '2026-11-02T00:00:00Z',
      }),
    );
  }
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <FileArea tool={getTool(toolId)!} />
      </I18nextProvider>
    </Provider>,
  );
}

beforeEach(() => {
  (track as jest.Mock).mockClear();
  mockImage.mockReset();
  mockDoc.mockReset();
});

describe('FileArea', () => {
  it('shows a size rejection card with formatted numbers and tracks file_rejected without a name', async () => {
    await setup('video-compress');
    mockImage.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'content://v',
          fileName: 'secret holiday.mp4',
          mimeType: 'video/mp4',
          fileSize: 300 * 1024 * 1024,
          duration: 60000,
          width: 1,
          height: 1,
        },
      ],
    });
    await press(screen.getByRole('button', { name: 'Photos & videos' }));
    await waitFor(() =>
      expect(
        screen.getByText('This file is 300 MB. Your plan accepts files up to 100 MB.'),
      ).toBeTruthy(),
    );
    expect(track).toHaveBeenCalledWith('file_rejected', {
      reason: 'too_large',
      file_extension: 'mp4',
      size_bytes: 300 * 1024 * 1024,
      limit_bytes: 100 * 1024 * 1024,
    });
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toContain('secret');
  });

  it('shows a duration rejection from the picker duration', async () => {
    await setup('video-compress');
    mockImage.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'content://v',
          fileName: 'a.mp4',
          mimeType: 'video/mp4',
          fileSize: 10,
          duration: 1800000,
        },
      ],
    });
    await press(screen.getByRole('button', { name: 'Photos & videos' }));
    await waitFor(() =>
      expect(
        screen.getByText('This video is 30:00 long. Your plan allows up to 20:00.'),
      ).toBeTruthy(),
    );
  });

  it('shows the unsupported card naming the tool, and the empty card', async () => {
    await setup('image-resize');
    mockDoc.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file://a', name: 'a.zip', mimeType: 'application/zip', size: 5 },
        { uri: 'file://b', name: 'b.png', mimeType: 'image/png', size: 0 },
      ],
    });
    await press(screen.getByRole('button', { name: 'Files' }));
    await waitFor(() => expect(screen.getByText('This file is empty.')).toBeTruthy());
    expect(screen.getByText("Resize image doesn't accept this kind of file.")).toBeTruthy();
  });

  it('skips size checks while the account snapshot is not loaded', async () => {
    await setup('image-resize', false);
    mockDoc.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://b', name: 'b.zip', mimeType: 'application/zip', size: 5e12 }],
    });
    await press(screen.getByRole('button', { name: 'Files' }));
    await waitFor(() => expect(screen.getByText(/doesn't accept this kind/)).toBeTruthy());
    expect(screen.queryByText(/Your plan accepts/)).toBeNull();
  });

  it('offers only the Files button for a PDF-only tool', async () => {
    await setup('pdf-to-image');
    expect(screen.queryByRole('button', { name: 'Photos & videos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy();
  });
});
