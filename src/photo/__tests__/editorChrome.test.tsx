/**
 * RTL (ticket MA50 acceptance 7): the chrome follows the locale (Arabic strings, logical layout),
 * while the canvas container and the curves graph are forced `direction: 'ltr'`.
 */
import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { I18nManager, StyleSheet } from 'react-native';
import { changeAppLanguage, i18n } from '@/i18n';
import { makePhotoStore, photoActions } from '../photoStore';
import { newPhotoDoc } from '../photoTypes';
import { EditorProvider } from '../ui/EditorContext';
import { ToolStrip, TopBar } from '../ui/EditorChrome';
import { CurvesSheet } from '../ui/sheets/CurvesSheet';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

afterEach(async () => {
  Object.defineProperty(I18nManager, 'isRTL', { value: false, configurable: true });
  await changeAppLanguage(i18n, 'en-US');
});

async function chrome() {
  const store = makePhotoStore();
  store.dispatch(photoActions.loaded({ projectId: 'p1', doc: newPhotoDoc(400, 300), name: 'IMG_1' }));
  return render(
    <I18nextProvider i18n={i18n}>
      <EditorProvider value={{ store, haptics: false }}>
        <TopBar name="IMG_1" upload={{ kind: 'uploading', fraction: 0.42 }} onBack={() => undefined} onSave={() => undefined} onExport={() => undefined} saving={false} />
        <ToolStrip active="color" onPick={() => undefined} />
        <CurvesSheet />
      </EditorProvider>
    </I18nextProvider>,
  );
}

describe('editor chrome in Arabic (RTL)', () => {
  it('renders the strip and chip in Arabic; the curves graph stays LTR (snapshot)', async () => {
    Object.defineProperty(I18nManager, 'isRTL', { value: true, configurable: true });
    await changeAppLanguage(i18n, 'ar-SA');
    const r = await chrome();
    expect(screen.getByTestId('photo-upload-chip')).toBeTruthy();
    for (const k of ['basic', 'color', 'curves', 'levels', 'bw', 'more', 'layers']) {
      expect(screen.getByTestId(`photo-strip-${k}`)).toBeTruthy();
    }
    // Not English: the strip label for Basic is the Arabic one.
    expect(screen.queryByText('Basic')).toBeNull();
    const graph = screen.getByTestId('photo-curves-graph');
    expect(StyleSheet.flatten(graph.props.style).direction).toBe('ltr');
    expect(r.toJSON()).toMatchSnapshot();
  });

  it('Save stays disabled until the project exists and something changed', async () => {
    await chrome();
    expect(screen.getByTestId('photo-save').props.accessibilityState?.disabled).toBe(true);
  });
});
