import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import IntakeScreen from '../../../app/(app)/intake';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { toolOpened } from '@/state/slices/settings';
import { toolsForKinds } from '../intakeTools';
import { setIntakeBatch } from '../session';
import type { IntakeFile, Rejection } from '../types';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  Redirect: ({ href }: { href: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));

const file = (id: string, kind: IntakeFile['mediaKind'], ext: string): IntakeFile => ({
  id,
  uri: `file:///c/${id}.${ext}`,
  name: `${id}.${ext}`,
  extension: ext,
  mimeType: '',
  mediaKind: kind,
  sizeBytes: 2048,
  source: 'share',
  copiedAt: 1,
});
const bad: Rejection = {
  id: 'r',
  name: 'x.zip',
  extension: 'zip',
  mediaKind: null,
  sizeBytes: 3,
  reason: 'unsupported_type',
};

async function mount(recents: string[] = []) {
  const { store } = await makeReadyStore();
  recents.forEach((id) => store.dispatch(toolOpened(id)));
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <IntakeScreen />
      </I18nextProvider>
    </Provider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  setIntakeBatch(null);
});

describe('toolsForKinds', () => {
  it('intersects kinds and puts recents first', () => {
    const ids = toolsForKinds(['image'], ['image-compress']).map((t) => t.id);
    expect(ids[0]).toBe('image-compress');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('image-resize');
    expect(ids).not.toContain('video-compress');
  });

  it('is empty for mixed kinds no tool accepts together, and for no kinds', () => {
    expect(toolsForKinds(['image', 'video'], []).map((t) => t.id)).toEqual([
      'inspect-metadata',
      'strip-metadata',
    ]);
    expect(toolsForKinds([], [])).toEqual([]);
  });

  it('pdf offers pdf-to-image and inspect metadata', () => {
    const ids = toolsForKinds(['pdf'], []).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['pdf-to-image', 'inspect-metadata']));
  });
});

describe('IntakeScreen', () => {
  it('redirects to Tools when there is no pending share', async () => {
    await mount();
    expect(screen.getByText('redirect:/(app)/(tabs)')).toBeTruthy();
  });

  it('lists image tools recents first and opens one with the files attached', async () => {
    setIntakeBatch({ files: [file('a', 'image', 'png')], rejected: [] });
    await mount(['image-resize']);
    expect(screen.getByText('Tools for this file')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Resize image');
    await fireEvent.press(buttons[0]!);
    expect(mockPush).toHaveBeenCalledWith('/(app)/tool/image/image-resize?from=intake&intake=a');
  });

  it('uses the plural heading for several files', async () => {
    setIntakeBatch({ files: [file('a', 'image', 'png'), file('b', 'image', 'jpg')], rejected: [] });
    await mount();
    expect(screen.getByText('Tools for these 2 files')).toBeTruthy();
  });

  it('explains when kinds need different tools', async () => {
    setIntakeBatch({ files: [file('a', 'image', 'png'), file('b', 'audio', 'mp3')], rejected: [] });
    await mount();
    expect(
      screen.getByText('These files need different tools. Share them one kind at a time.'),
    ).toBeTruthy();
    // Only the metadata tools take mixed kinds (strip accepts image, video and audio since MA21).
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Inspect metadata')).toBeTruthy();
    expect(screen.getByText('Remove metadata')).toBeTruthy();
  });

  it('shows the unsupported state with a Back to Tools button', async () => {
    setIntakeBatch({ files: [], rejected: [bad] });
    await mount();
    expect(screen.getByText("Media Manipulator can't open this kind of file")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to Tools' }));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
  });
});
