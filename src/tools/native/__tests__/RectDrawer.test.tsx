import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { i18n } from '@/i18n';
import type { ObjectRect } from '../../options/ai';
import { removeObjectBlockReason } from '../../options/ai';
import { RectDrawer } from '../RectDrawer';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

let latest: ObjectRect[] = [];
let n = 0;
function Harness() {
  const [rects, setRects] = useState<ObjectRect[]>([]);
  latest = rects;
  return (
    <I18nextProvider i18n={i18n}>
      <RectDrawer
        uri="file:///a.jpg"
        aspect={1}
        rects={rects}
        onChange={setRects}
        newId={() => `t${(n += 1)}`}
      />
    </I18nextProvider>
  );
}

async function mount() {
  n = 0;
  await render(<Harness />);
  await act(async () => {
    fireEvent(screen.getByTestId('rect-canvas'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } },
    });
  });
}

const drag = async (from: [number, number], to: [number, number]) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('rect-pan'), [
      { x: from[0], y: from[1], translationX: 0, translationY: 0 },
      { x: to[0], y: to[1], translationX: to[0] - from[0], translationY: to[1] - from[1] },
      { x: to[0], y: to[1], translationX: to[0] - from[0], translationY: to[1] - from[1] },
    ]);
  });
};

describe('RectDrawer', () => {
  it('adds a normalized rectangle from a pan gesture and Run can then enable', async () => {
    await mount();
    expect(removeObjectBlockReason({ rects: latest })).toBe('needs_rect');
    await drag([40, 80], [240, 280]);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ x: 0.1, y: 0.2 });
    expect(latest[0]!.width).toBeCloseTo(0.5, 6);
    expect(latest[0]!.height).toBeCloseTo(0.5, 6);
    expect(removeObjectBlockReason({ rects: latest })).toBeNull();
    expect(screen.getByTestId('rect-count').props.children).toContain('1');
  });

  it('drops a tap that is too small to be deliberate', async () => {
    await mount();
    await drag([100, 100], [101, 101]);
    expect(latest).toHaveLength(0);
  });

  it('moves a rectangle when dragged from inside it, clamped to the image', async () => {
    await mount();
    await drag([40, 40], [140, 140]);
    const before = latest[0]!;
    await drag([80, 80], [480, 80]);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.x).toBeCloseTo(1 - before.width, 6);
    expect(latest[0]!.y).toBeCloseTo(before.y, 6);
  });

  it('deletes the selected box and clears all', async () => {
    await mount();
    await drag([20, 20], [100, 100]);
    await drag([200, 200], [300, 300]);
    expect(latest).toHaveLength(2);
    await act(async () => {
      fireEvent.press(screen.getByText('Delete box'));
    });
    expect(latest).toHaveLength(1);
    await act(async () => {
      fireEvent.press(screen.getByText('Clear all'));
    });
    expect(latest).toHaveLength(0);
  });
});
