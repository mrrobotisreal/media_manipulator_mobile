/**
 * MA60: `PhotoCanvas` on react-native-skia 3, where the pipeline's `render` and `readPixels` are
 * promises. The histogram tick awaits the readback (a Promise handed to `computeHistogram64` would
 * count nothing). The pipeline is a fake; the canvas renders through the jest Skia mock (Views).
 */
import { act, render } from '@testing-library/react-native';
import type { SkImage } from 'react-native-skia';
import { computeHistogram64, type Histogram64 } from '../../histogram';
import { newPhotoDoc, parsePhotoDoc, type PhotoDoc } from '../../photoTypes';
import { PhotoCanvas, type DocFeed } from '../PhotoCanvas';
import type { PhotoPipeline } from '../pipeline';

// The shared reanimated mock loads react-native-worklets' native module, which has no jest backing
// (as in CropRectEditor.test.tsx): shared values, derived values and a no-op animated reaction.
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (v: unknown) => ({ value: v }),
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useAnimatedReaction: () => undefined,
  withTiming: (v: unknown) => v,
}));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (...a: unknown[]) => void) => fn }));
jest.mock('react-native-gesture-handler', () => {
  const chain = (): Record<string, unknown> =>
    new Proxy({}, { get: (_t, _k) => () => chain() }) as Record<string, unknown>;
  return {
    Gesture: new Proxy({}, { get: () => () => chain() }),
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});

function doc(w: number): PhotoDoc {
  const r = parsePhotoDoc(newPhotoDoc(w, 10));
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

function feed(initial: PhotoDoc) {
  let cur = initial;
  const ls = new Set<() => void>();
  const f: DocFeed = {
    get: () => cur,
    subscribe: (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
  return {
    f,
    set(d: PhotoDoc) {
      cur = d;
      ls.forEach((l) => l());
    },
  };
}

const image = { width: () => 10, height: () => 10 } as unknown as SkImage;

describe('PhotoCanvas with an async pipeline (Skia 3)', () => {
  it('the histogram tick awaits the readback and reports the real pixels', async () => {
    const px = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]);
    const pipeline = {
      render: jest.fn(async () => ({ shader: {}, width: 10, height: 10 })),
      readPixels: jest.fn(async () => ({ pixels: px, width: 2, height: 1 })),
    } as unknown as PhotoPipeline;
    const seen: Histogram64[] = [];
    await render(
      <PhotoCanvas
        image={image}
        sourceId="s"
        previewScale={1}
        doc={feed(doc(10)).f}
        pipeline={pipeline}
        onHistogram={(h) => seen.push(h)}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.count).toBe(2);
    expect(seen[0]).toEqual(computeHistogram64(px));
  });
});
