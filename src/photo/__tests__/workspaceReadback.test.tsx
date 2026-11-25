/**
 * MA60: the editor workspace's readback sites on react-native-skia 3 (readback is a promise), over
 * the real hook with CanvasKit's JSI API. Each test asserts real pixels reach the consumer: Auto's
 * 256-bin histogram, the preset thumbnails, the account thumbnail PNG and the eyedropper RGB. A
 * dropped `await` either throws in `pixelBytes` or leaves the value null forever, and fails here.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { PNG } from 'pngjs';
import type { AiDeps } from '../aiApi';
import { makePhotoStore, photoActions } from '../photoStore';
import { newPhotoDoc, parsePhotoDoc, type AdjustmentLayer, type PhotoDoc } from '../photoTypes';
import type { SkiaApi } from '../skia/shaderChain';
import { rgbaImage } from '../skia/testing/fixtureSource';
import { loadSkiaApi } from '../skia/testing/skiaTestApi';
import { useEditorWorkspace, type WorkspaceIo } from '../ui/useEditorWorkspace';

jest.mock('@/analytics/track', () => ({ track: jest.fn(), setContext: jest.fn() }));
jest.setTimeout(60_000);

const W = 8;
const H = 4;

function doc(): PhotoDoc {
  const r = parsePhotoDoc(newPhotoDoc(W, H));
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

let api: SkiaApi;
beforeAll(async () => {
  api = await loadSkiaApi();
});

function setup() {
  // Left half red, right half blue, opaque.
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1)
      rgba.set(x < W / 2 ? [200, 0, 0, 255] : [0, 0, 200, 255], (y * W + x) * 4);
  const original = rgbaImage(api, W, H, rgba, true);
  const store = makePhotoStore();
  store.dispatch(photoActions.loaded({ projectId: null, doc: doc() }));
  const written: Uint8Array[] = [];
  const io: WorkspaceIo = {
    ai: {} as AiDeps,
    subjectBytes: async () => null,
    baseImage: async () => null,
    writeMask: async (b) => {
      written.push(b);
      return 'file:///cache/thumb.png';
    },
    renderHealMask: async () => new Uint8Array([1]),
  };
  const props = {
    api,
    io,
    store,
    original,
    projectId: null,
    onLimit: () => false,
    onNotice: jest.fn(),
  };
  return { props, written };
}

const invert: AdjustmentLayer[] = (() => {
  const r = parsePhotoDoc({ ...newPhotoDoc(W, H), layers: [{ id: 'i', type: 'invert' }] });
  if (!r.ok) throw new Error(r.error);
  return r.doc.layers;
})();

describe('workspace readback on Skia 3 (async)', () => {
  it("Auto's 256-bin histogram: null while the readback runs, then the real bins", async () => {
    const { props } = setup();
    const { result } = await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(result.current.source).not.toBeNull());
    let first: ReturnType<NonNullable<typeof result.current.extra.histogram256>> = null;
    await act(async () => {
      first = result.current.extra.histogram256!();
    });
    expect(first).toBeNull();
    await waitFor(() => expect(result.current.extra.histogram256!()).not.toBeNull());
    const h = result.current.extra.histogram256!()!;
    // Every one of the W x H pixels counted: red at 200 and blue at 200 on their channels.
    expect(h.r.reduce((a, b) => a + b, 0)).toBe(W * H);
    expect(h.r[200]).toBe((W * H) / 2);
    expect(h.b[200]).toBe((W * H) / 2);
  });

  it('a preset thumbnail: null while it renders, then a real image through the look', async () => {
    const { props } = setup();
    const { result } = await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(result.current.source).not.toBeNull());
    let first: ReturnType<NonNullable<typeof result.current.extra.presetThumb>> = null;
    await act(async () => {
      first = result.current.extra.presetThumb!('invert', invert);
    });
    expect(first).toBeNull();
    await waitFor(() => expect(result.current.extra.presetThumb!('invert', invert)).not.toBeNull());
    const img = result.current.extra.presetThumb!('invert', invert)!;
    expect([img.width(), img.height()]).toEqual([W, H]);
    const px = await img.readPixels(0, 0, { width: W, height: H, colorType: 4, alphaType: 3 });
    // Inverted red (200, 0, 0) is (55, 255, 255).
    expect(Array.from((px as Uint8Array).slice(0, 4))).toEqual([55, 255, 255, 255]);
  });

  it('the account thumbnail is a real PNG written to the cache', async () => {
    const { props, written } = setup();
    const { result } = await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(result.current.source).not.toBeNull());
    let uri: string | null = null;
    await act(async () => {
      uri = await result.current.extra.presetThumbFile!(invert);
    });
    expect(uri).toBe('file:///cache/thumb.png');
    expect(written).toHaveLength(1);
    const png = PNG.sync.read(Buffer.from(written[0]!));
    expect([png.width, png.height]).toEqual([W, H]);
    expect(Array.from(png.data.slice(0, 3))).toEqual([55, 255, 255]);
  });

  it('the eyedropper resolves the RGB under the finger', async () => {
    const { props } = setup();
    const { result } = await renderHook(() => useEditorWorkspace(props));
    await waitFor(() => expect(result.current.source).not.toBeNull());
    await expect(result.current.readPixel({ x: 0.1, y: 0.5 })).resolves.toEqual({
      r: 200,
      g: 0,
      b: 0,
    });
    await expect(result.current.readPixel({ x: 0.9, y: 0.5 })).resolves.toEqual({
      r: 0,
      g: 0,
      b: 200,
    });
  });
});
