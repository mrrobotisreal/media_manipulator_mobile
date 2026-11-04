import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { addCurvePoint, curvePoints, dragCurvePoint, hslRanges } from '../edits';
import { makePhotoStore, photoActions } from '../photoStore';
import { newPhotoDoc } from '../photoTypes';
import { EditorProvider } from '../ui/EditorContext';
import { ColorSheet } from '../ui/sheets/ColorSheet';
import { hitPoint } from '../ui/sheets/CurvesSheet';
import { dropIndex } from '../ui/sheets/LayersSheet';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

async function setup(ui: React.ReactElement) {
  const store = makePhotoStore();
  store.dispatch(photoActions.loaded({ projectId: 'p1', doc: newPhotoDoc(400, 300) }));
  const noteAdjustment = jest.fn();
  await render(
    <I18nextProvider i18n={i18n}>
      <EditorProvider value={{ store, noteAdjustment, haptics: false }}>{ui}</EditorProvider>
    </I18nextProvider>,
  );
  return { store, noteAdjustment };
}

describe('Colour sheet', () => {
  it('"Grey except this" on the Reds chip writes saturation -100 to the other five ranges', async () => {
    const { store, noteAdjustment } = await setup(<ColorSheet />);
    await fireEvent.press(screen.getByTestId('photo-hsl-reds'));
    await fireEvent.press(await screen.findByTestId('photo-grey-except'));
    const sat = Object.fromEntries(
      hslRanges(store.getState().doc).map((r) => [r.id, r.saturation]),
    );
    expect(sat).toEqual({
      reds: 0,
      yellows: -100,
      greens: -100,
      cyans: -100,
      blues: -100,
      magentas: -100,
    });
    expect(store.getState().past).toHaveLength(1); // one undo step
    expect(noteAdjustment).toHaveBeenCalledWith('hsl', 'saturation');
  });

  it('has no "Grey except" action on All colors', async () => {
    await setup(<ColorSheet />);
    expect(screen.queryByTestId('photo-grey-except')).toBeNull();
  });
});

describe('Curves sheet helpers', () => {
  it('hit-tests points within 28 px', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ];
    expect(hitPoint(pts, 160, 160, 320)).toBe(1);
    expect(hitPoint(pts, 100, 300, 320)).toBe(-1);
  });

  it('the curves sheet refuses a non-monotone point (the doc stays strictly increasing)', () => {
    let d = addCurvePoint(newPhotoDoc(1, 1), 'r', 0.3, 0.3).doc;
    d = addCurvePoint(d, 'r', 0.6, 0.7).doc;
    const r = dragCurvePoint(d, 'r', 2, 0.1, 0.9); // drag the 0.6 point left past 0.3
    expect(r.refused).toBe(true);
    const xs = curvePoints(r.doc, 'r').map((p) => p.x);
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1]!)).toBe(true);
  });
});

describe('Layers sheet helpers', () => {
  it('drop index follows the drag in 56 px rows, clamped', () => {
    expect(dropIndex(2, -112, 5)).toBe(0);
    expect(dropIndex(0, 30, 5)).toBe(1);
    expect(dropIndex(4, 500, 5)).toBe(4);
  });
});
