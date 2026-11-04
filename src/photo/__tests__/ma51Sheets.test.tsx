/**
 * MA51 sheet flows (acceptance 4 and 5) with a plain store and a fake workspace: "Select subject"
 * installs the mask, the geometry crop writes a normalized rect, a preset appends a group, the
 * Heal press reports, history jumps; RTL snapshot of the Masks and Geometry sheets.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PNG } from 'pngjs';
import { I18nextProvider } from 'react-i18next';
import { I18nManager } from 'react-native';
import { changeAppLanguage, i18n } from '@/i18n';
import { createSnapshots } from '../history';
import { maskOfLayer, addComponent } from '../maskOps';
import { makePhotoStore, mutate, photoActions } from '../photoStore';
import { newPhotoDoc, parsePhotoDoc, maskComponentSchema, type PhotoDoc } from '../photoTypes';
import { createToolStore } from '../tools/toolState';
import { EditorProvider, type EditorTools } from '../ui/EditorContext';
import { GeometrySheet } from '../ui/sheets/GeometrySheet';
import { HealSheet } from '../ui/sheets/HealSheet';
import { HistorySheet } from '../ui/sheets/HistorySheet';
import { MasksSheet } from '../ui/sheets/MasksSheet';
import { PresetsSheet } from '../ui/sheets/PresetsSheet';
import type { KvStorage } from '../presets/presetStore';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@shopify/react-native-skia', () => ({ Canvas: () => null, Image: () => null }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/quota/QuotaChip', () => ({ QuotaChip: () => null }));

const pngEncoder = async (rgba: Uint8ClampedArray, width: number, height: number) => {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
};

function docWith(): PhotoDoc {
  const r = parsePhotoDoc({
    ...newPhotoDoc(4000, 3000),
    layers: [{ id: 'L', type: 'exposure', params: { ev: 1 } }],
  });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

async function setup(ui: React.ReactElement, extra: Partial<EditorTools> = {}) {
  const store = makePhotoStore();
  store.dispatch(photoActions.loaded({ projectId: 'p1', doc: docWith() }));
  store.dispatch(photoActions.selected('L'));
  const tools = createToolStore();
  const x: EditorTools = {
    tools,
    snapshots: createSnapshots(),
    sourceSize: { width: 4000, height: 3000 },
    capabilities: { aiMasks: true, heal: true },
    ...extra,
  };
  const r = await render(
    <I18nextProvider i18n={i18n}>
      <EditorProvider value={{ store, haptics: false, extra: x }}>{ui}</EditorProvider>
    </I18nextProvider>,
  );
  return { store, tools, x, r };
}

afterEach(async () => {
  Object.defineProperty(I18nManager, 'isRTL', { value: false, configurable: true });
  await changeAppLanguage(i18n, 'en-US');
});

describe('Masks sheet', () => {
  it('"Select subject" calls the workspace for the selected layer; the installed component shows', async () => {
    const selectSubject = jest.fn(async () => undefined);
    const { store } = await setup(<MasksSheet />, { selectSubject });
    await fireEvent.press(screen.getByTestId('photo-mask-add-subject'));
    expect(selectSubject).toHaveBeenCalledWith('L');
    // The workspace installs the component like this (see useEditorWorkspace.selectSubject):
    mutate(store, 'selectSubject', (d) =>
      addComponent(
        d,
        'L',
        maskComponentSchema.parse({ kind: 'subject', mode: 'add', maskRef: 'masks/subj-1.png' }),
      ),
    );
    expect(maskOfLayer(store.getState().doc!, 'L')!.components[0]).toMatchObject({
      kind: 'subject',
    });
    expect(await screen.findByTestId('photo-mask-component')).toBeTruthy();
  });

  it('hides Select subject when AI masks are off; arms the brush; switches the mask view', async () => {
    const { tools } = await setup(<MasksSheet />, { capabilities: { aiMasks: false, heal: true } });
    expect(screen.queryByTestId('photo-mask-add-subject')).toBeNull();
    await fireEvent.press(screen.getByTestId('photo-mask-add-brush'));
    expect(tools.get().tool).toBe('brush');
    await fireEvent.press(screen.getByText('Overlay'));
    expect(tools.get().maskView).toBe('overlay');
  });

  it('a local adjustment adds a layer with an empty mask and arms the brush', async () => {
    const { store, tools } = await setup(<MasksSheet />);
    await fireEvent.press(screen.getByTestId('photo-mask-local-localBasic'));
    const d = store.getState().doc!;
    expect(d.layers.map((l) => l.type)).toEqual([
      'exposure',
      'exposure',
      'tone',
      'vibranceSaturation',
    ]);
    expect(Object.keys(d.masks ?? {})).toHaveLength(1);
    expect(tools.get().tool).toBe('brush');
  });
});

describe('Geometry sheet', () => {
  it('an aspect chip writes a normalized crop (16:9 on 4:3) and rotate steps add', async () => {
    const { store } = await setup(<GeometrySheet encodePng={pngEncoder} brushAlpha={() => null} />);
    await fireEvent.press(screen.getByTestId('photo-aspect-16:9'));
    await waitFor(() => expect(store.getState().doc!.geometry.crop).not.toBeNull());
    const c = store.getState().doc!.geometry.crop!;
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.width).toBeCloseTo(1, 6);
    expect(c.height).toBeCloseTo(((4000 / 16) * 9) / 3000, 6);
    expect(c.y).toBeCloseTo((1 - c.height) / 2, 6);
    await fireEvent.press(screen.getByTestId('photo-rotate-right'));
    expect(store.getState().doc!.geometry.rotate).toBe(90);
  });
});

describe('Heal sheet', () => {
  it('Heal is disabled without strokes and calls the workspace with them; hidden when off', async () => {
    const heal = jest.fn(async () => undefined);
    const { tools } = await setup(<HealSheet />, { heal });
    expect(screen.getByTestId('photo-heal-press').props.accessibilityState?.disabled).toBe(true);
    tools.set({ healStrokes: 3 });
    await waitFor(() => expect(screen.getByText('Spots marked: 3')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('photo-heal-press'));
    expect(heal).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('photo-redeye-tool'));
    expect(tools.get().tool).toBe('redEye');
  });

  it('shows "unavailable" when capabilities.heal is false', async () => {
    await setup(<HealSheet />, { capabilities: { aiMasks: true, heal: false } });
    expect(screen.getByTestId('photo-heal-off')).toBeTruthy();
    expect(screen.queryByTestId('photo-heal-press')).toBeNull();
  });
});

describe('Presets sheet', () => {
  it('a built-in look appends one group and reports builtin', async () => {
    const map = new Map<string, string>();
    const kv: KvStorage = {
      getItem: async (k) => map.get(k),
      setItem: async (k, v) => void map.set(k, v),
    };
    const onPresetApplied = jest.fn();
    const { store } = await setup(<PresetsSheet kv={kv} />, { onPresetApplied });
    await fireEvent.press(screen.getByTestId('photo-preset-color-pop-blue'));
    const groups = new Set(
      store
        .getState()
        .doc!.layers.map((l) => l.group)
        .filter(Boolean),
    );
    expect([...groups]).toEqual(['Preset: Color pop: blue']);
    expect(store.getState().past.at(-1)!.label).toBe('Preset|builtin:color-pop-blue');
    expect(onPresetApplied).toHaveBeenCalledWith('color-pop-blue', true);
  });
});

describe('History sheet', () => {
  it('lists steps and jumps back to the original', async () => {
    const { store } = await setup(<HistorySheet />);
    expect(store.getState().past).toHaveLength(0);
    mutate(store, 'rotate', (d) => ({ ...d, geometry: { ...d.geometry, rotate: 90 } }));
    await waitFor(() => expect(screen.getByTestId('photo-history-1')).toBeTruthy());
    expect(screen.getByText('Rotate')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('photo-history-0'));
    expect(store.getState().doc!.geometry.rotate).toBe(0);
  });
});

describe('RTL (Arabic)', () => {
  it('Masks and Geometry sheets render the Arabic copy (snapshot)', async () => {
    Object.defineProperty(I18nManager, 'isRTL', { value: true, configurable: true });
    await changeAppLanguage(i18n, 'ar-SA');
    const { r } = await setup(
      <>
        <MasksSheet />
        <GeometrySheet encodePng={pngEncoder} brushAlpha={() => null} />
      </>,
    );
    expect(screen.queryByText('Linear gradient')).toBeNull();
    expect(screen.queryByText('Rotate and flip')).toBeNull();
    expect(r.toJSON()).toMatchSnapshot();
  });
});
