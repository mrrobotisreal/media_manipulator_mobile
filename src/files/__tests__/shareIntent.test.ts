import { track } from '@/analytics/track';
import { processShare, sharedKinds, sharedToIncoming } from '../share-intent';
import { getIntakeBatch } from '../session';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-share-intent', () => ({ useShareIntentContext: jest.fn() }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const mockPrepare = jest.fn();
jest.mock('../intake', () => ({ prepareIntake: (...a: unknown[]) => mockPrepare(...a) }));

const f = (
  o: Partial<{ path: string; mimeType: string; fileName: string; size: number | null }>,
) => ({
  path: 'content://x/1',
  mimeType: 'image/png',
  fileName: 'a.png',
  size: 10,
  width: null,
  height: null,
  duration: null,
  ...o,
});

beforeEach(() => {
  (track as jest.Mock).mockClear();
  mockPrepare.mockReset();
});

describe('share intent mapping', () => {
  it('drops entries without a path (text/url-only shares)', () => {
    expect(sharedToIncoming(null)).toEqual([]);
    expect(sharedToIncoming([f({ path: '' })])).toEqual([]);
    expect(sharedToIncoming([f({})])).toEqual([
      expect.objectContaining({ uri: 'content://x/1', name: 'a.png', mimeType: 'image/png' }),
    ]);
  });

  it('classifies by MIME with extension fallback; anything else is null (JS filter)', () => {
    const inc = sharedToIncoming([
      f({ mimeType: 'image/jpeg', fileName: 'a.jpg' }),
      f({ mimeType: 'application/octet-stream', fileName: 'b.mp3' }),
      f({ mimeType: 'application/pdf', fileName: 'c.pdf' }),
      f({ mimeType: 'application/zip', fileName: 'd.zip' }),
      f({ mimeType: 'text/plain', fileName: 'e.txt' }),
    ]);
    expect(sharedKinds(inc)).toEqual(['image', 'audio', 'pdf', null, null]);
  });
});

describe('processShare', () => {
  const prepared = { accepted: [], rejected: [] };

  it('emits share_intent_received with the common kind, pdf as document', async () => {
    mockPrepare.mockResolvedValue(prepared);
    await processShare(sharedToIncoming([f({ mimeType: 'application/pdf', fileName: 'c.pdf' })]));
    expect(track).toHaveBeenCalledWith('share_intent_received', {
      media_kind: 'document',
      count: 1,
    });
  });

  it('emits mixed for different kinds and counts every file', async () => {
    mockPrepare.mockResolvedValue(prepared);
    await processShare(
      sharedToIncoming([f({}), f({ mimeType: 'video/mp4', fileName: 'v.mp4' }), f({})]),
    );
    expect(track).toHaveBeenCalledWith('share_intent_received', { media_kind: 'mixed', count: 3 });
  });

  it('tracks file_selected(source=share) and file_rejected, and stores the batch', async () => {
    mockPrepare.mockResolvedValue({
      accepted: [
        {
          id: 'i1',
          uri: 'file:///c/a.png',
          name: 'secret.png',
          extension: 'png',
          mimeType: 'image/png',
          mediaKind: 'image',
          sizeBytes: 1048576,
          source: 'share',
          copiedAt: 1,
        },
      ],
      rejected: [
        {
          id: 'r1',
          name: 'x.zip',
          extension: 'zip',
          mediaKind: null,
          sizeBytes: 5,
          reason: 'unsupported_type',
        },
      ],
    });
    const batch = await processShare(sharedToIncoming([f({})]), {
      maxFileBytes: 1,
      maxVideoSeconds: 1,
    });
    expect(mockPrepare).toHaveBeenCalledWith(expect.any(Array), {
      source: 'share',
      limits: { maxFileBytes: 1, maxVideoSeconds: 1 },
    });
    expect(track).toHaveBeenCalledWith('file_selected', {
      file_extension: 'png',
      size_bytes: 1048576,
      file_size_mb: 1,
      media_kind: 'image',
      source: 'share',
    });
    expect(track).toHaveBeenCalledWith('file_rejected', {
      reason: 'unsupported_type',
      file_extension: 'zip',
      size_bytes: 5,
      limit_bytes: undefined,
    });
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toContain('secret');
    expect(getIntakeBatch()).toBe(batch);
  });
});
