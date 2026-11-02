import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { CropRectEditor } from '../CropRectEditor';

// The shared reanimated mock loads react-native-worklets' native module, which has no jest backing;
// this editor only needs shared values, animated styles and a plain Animated.View.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => object) => fn(),
    runOnJS: (fn: unknown) => fn,
  };
});

async function setup(onChange = jest.fn(), aspect: number | null = null) {
  await render(
    <I18nextProvider i18n={i18n}>
      <CropRectEditor
        uri="file:///a.jpg"
        sourceWidth={4000}
        sourceHeight={3000}
        value={null}
        aspect={aspect}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  await act(async () => {
    fireEvent(screen.getByTestId('crop-canvas'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } },
    });
  });
  return onChange;
}

jest.mock('react-native-gesture-handler', () => {
  const chain: object = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});

describe('CropRectEditor', () => {
  it('reports a centred 80 % default rect in source pixels', async () => {
    const onChange = await setup();
    const rect = onChange.mock.calls.at(-1)![0];
    expect(rect).toEqual({ x: 400, y: 300, width: 3200, height: 2400 });
    expect(screen.getByTestId('crop-readout').props.children).toContain('3200');
  });

  it('applies a locked aspect to the default rect', async () => {
    const onChange = await setup(jest.fn(), 1);
    const rect = onChange.mock.calls.at(-1)![0];
    expect(Math.abs(rect.width - rect.height)).toBeLessThanOrEqual(1);
  });

  it('renders four labelled handles', async () => {
    await setup();
    for (const c of ['tl', 'tr', 'bl', 'br'])
      expect(screen.getByTestId(`crop-handle-${c}`)).toBeTruthy();
  });
});
