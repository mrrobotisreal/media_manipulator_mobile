import { loadLocalPreview, loadProxyPreview, planLocal, type SourceDeps } from '../source';

type Img = { w: number; h: number };
const deps = (local: Img | null, proxy: Img | null = { w: 1920, h: 1440 }): SourceDeps<Img> => ({
  decodeLocal: jest.fn(async () => local),
  decodeProxy: jest.fn(async () => proxy),
  size: (i) => ({ width: i.w, height: i.h }),
  downscale: jest.fn((_i: Img, w: number, h: number) => ({ w, h })),
});

describe('preview source', () => {
  it('a 12 MP phone photo decodes locally and is downscaled to an 8 MP preview at once', async () => {
    expect(planLocal(4000, 3000)).toBe('decode');
    const d = deps({ w: 4000, h: 3000 });
    const s = await loadLocalPreview(d, 'file:///a.jpg', { width: 4000, height: 3000 });
    expect(s?.origin).toBe('local');
    expect(s!.width * s!.height).toBeLessThanOrEqual(8_000_000);
    expect(s!.scale).toBeCloseTo(Math.sqrt(8 / 12), 3);
  });

  it('a 40 MP original waits for the server proxy (no 160 MB decode)', async () => {
    expect(planLocal(7728, 5152)).toBe('wait_for_proxy');
    const d = deps({ w: 7728, h: 5152 });
    expect(await loadLocalPreview(d, 'file:///a.jpg', { width: 7728, height: 5152 })).toBeNull();
    expect(d.decodeLocal).not.toHaveBeenCalled();
  });

  it('decodes an 8 MP-or-smaller file locally at scale 1', async () => {
    const d = deps({ w: 3264, h: 2448 });
    const s = await loadLocalPreview(d, 'file:///a.jpg', { width: 3264, height: 2448 });
    expect(s).toMatchObject({ origin: 'local', scale: 1, width: 3264, height: 2448 });
  });

  it('re-checks the decoded size when the probe had none', async () => {
    const d = deps({ w: 7000, h: 5000 });
    expect(await loadLocalPreview(d, 'file:///a.heic', {})).toBeNull();
  });

  it('a decode failure falls back (null) instead of throwing', async () => {
    const d: SourceDeps<Img> = {
      ...deps(null),
      decodeLocal: jest.fn(async () => Promise.reject(new Error('codec'))),
    };
    expect(await loadLocalPreview(d, 'file:///a.tiff', { width: 100, height: 100 })).toBeNull();
  });

  it('the proxy reports its scale against the original', async () => {
    const s = await loadProxyPreview(deps(null), 'p1', { width: 7680, height: 5760 });
    expect(s).toMatchObject({ origin: 'proxy', scale: 0.25, width: 1920, height: 1440 });
  });
});
