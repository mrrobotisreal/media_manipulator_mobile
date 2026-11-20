/**
 * MA58 decision 1: History's Projects segment merges Aperture, Darkroom and Motion projects newest
 * first, filters by the chip row (remembered in MMKV), shows a per-source error line while the other
 * sources still list, and offers Open on the web (Motion: the editor; Darkroom: the Darkroom page).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import HistoryTab from '../../../app/(app)/(tabs)/history';
import { openWebPage } from '@/account/openWeb';
import { track } from '@/analytics/track';
import { setIdTokenProvider } from '@/api/authToken';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { studioSpriteUri, studioThumbAssetId } from '@/studio/mobile/api';
import { darkroomWebUrl, motionEditorWebUrl } from '@/vector/mobile/api';
import { loadProjectsFilter, PROJECTS_FILTER_KEY, saveProjectsFilter } from '../filterPref';
import { filterRows, mergeProjects } from '../merge';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => <View {...props} /> };
});
jest.mock('@/account/openWeb', () => ({ openWebPage: jest.fn(() => Promise.resolve()) }));
jest.mock('@/api/hooks', () => ({
  useGetAccountMeQuery: () => ({ data: { limits: { resultRetentionHours: 168 } } }),
}));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children: unknown }) => <View>{children as never}</View>,
  };
});

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const photo = (id: string, name: string, h: number) => ({
  id,
  name,
  revision: 1,
  status: 'ready',
  width: 4000,
  height: 3000,
  thumbUrl: `/api/photo/projects/${id}/thumb`,
  createdAt: iso(h + 10),
  updatedAt: iso(h),
});
const studio = (id: string, name: string, h: number, assetId = '') => ({
  id,
  name,
  schemaVersion: 3,
  fps: 30,
  width: 1920,
  height: 1080,
  durationSeconds: 75,
  tracks: [
    { id: 'a1', kind: 'audio', index: 0, muted: false, clips: [{ id: 'c0', assetId: 'aud' }] },
    {
      id: 'v1',
      kind: 'video',
      index: 0,
      muted: false,
      clips: assetId ? [{ id: 'c1', assetId }] : [],
    },
  ],
  captions: [],
  captionsEnabled: true,
  revision: 4,
  createdAt: iso(h + 10),
  updatedAt: iso(h),
});
const vector = (id: string, name: string, h: number) => ({
  id,
  name,
  revision: 2,
  thumbnailKey: `vector/u/${id}/thumb.png`,
  documentBytes: 900,
  createdAt: iso(h + 10),
  updatedAt: iso(h),
});

interface Fake {
  photo: unknown[];
  studio: unknown[];
  vector: unknown[];
  fail: Set<string>;
  calls: string[];
}
let fake: Fake;
const realFetch = global.fetch;
const json = (status: number, body: unknown) =>
  Promise.resolve({
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  });

function installFetch() {
  global.fetch = jest.fn((url: string) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    fake.calls.push(path);
    if (path === '/account/history')
      return json(200, { entries: [], total: 0, limit: 50, offset: 0 });
    if (path === '/photo/capabilities') return json(200, { enabled: true, render: true });
    for (const [src, route] of [
      ['photo', '/photo/projects'],
      ['studio', '/studio/projects'],
      ['vector', '/vector/projects'],
    ] as const) {
      if (path === route)
        return fake.fail.has(src)
          ? json(500, { error: 'Failed to list projects' })
          : json(200, { projects: fake[src] });
    }
    return json(404, { error: 'not found' });
  }) as unknown as typeof fetch;
}

async function mountProjects() {
  const { store } = await makeReadyStore();
  const utils = await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <HistoryTab />
      </I18nextProvider>
    </Provider>,
  );
  await fireEvent.press(await screen.findByText('Projects'));
  return { store, ...utils };
}

beforeEach(async () => {
  setIdTokenProvider(() => Promise.resolve('tok'));
  (track as jest.Mock).mockClear();
  (openWebPage as jest.Mock).mockClear();
  fake = { photo: [], studio: [], vector: [], fail: new Set(), calls: [] };
  installFetch();
  await saveProjectsFilter('all');
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('mergeProjects (pure)', () => {
  it('orders all three sources newest first and filters by product', () => {
    const rows = mergeProjects({
      aperture: [photo('p1', 'Beach', 5) as never],
      darkroom: [studio('s1', 'Trip cut', 1) as never, studio('s2', 'Old', 50) as never],
      motion: [vector('m1', 'Logo', 3) as never],
    });
    expect(rows.map((r) => r.key)).toEqual([
      'darkroom:s1',
      'motion:m1',
      'aperture:p1',
      'darkroom:s2',
    ]);
    expect(filterRows(rows, 'motion').map((r) => r.key)).toEqual(['motion:m1']);
    expect(filterRows(rows, 'all')).toHaveLength(4);
  });

  it('the Darkroom thumbnail is the first VIDEO clip asset; none without one', () => {
    expect(studioThumbAssetId(studio('s1', 'x', 0, 'vid-1') as never)).toBe('vid-1');
    expect(studioThumbAssetId(studio('s1', 'x', 0) as never)).toBeNull();
    expect(studioSpriteUri('vid-1')).toBe(
      'https://api.media-manipulator.com/api/studio/assets/vid-1/sprite',
    );
  });

  it('the web URLs: Motion opens its (unlocalized) editor, Darkroom its localized page', () => {
    expect(motionEditorWebUrl('m 1')).toBe('https://www.media-manipulator.com/motion/m%201');
    expect(darkroomWebUrl('en-US')).toBe('https://www.media-manipulator.com/tools/content-studio');
    expect(darkroomWebUrl('ru-RU')).toBe(
      'https://www.media-manipulator.com/ru/tools/content-studio',
    );
  });
});

describe('filter persistence', () => {
  it('remembers the chip in MMKV; unknown values fall back to all', async () => {
    await saveProjectsFilter('darkroom');
    expect(await loadProjectsFilter()).toBe('darkroom');
    const kv = { getItem: async () => 'bogus', setItem: async () => undefined };
    expect(await loadProjectsFilter(kv as never)).toBe('all');
    expect(PROJECTS_FILTER_KEY).toBe('projectsFilter');
  });
});

describe('History: Projects segment (MA58)', () => {
  it('lists Aperture, Darkroom and Motion rows merged newest first with badges', async () => {
    fake.photo = [photo('p1', 'Beach', 5)];
    fake.studio = [studio('s1', 'Trip cut', 1, 'vid-1')];
    fake.vector = [vector('m1', 'Logo', 3)];
    await mountProjects();
    await screen.findByTestId('project-row-s1');
    await screen.findByTestId('project-row-p1');
    const order = screen
      .getAllByTestId(/^project-row-/)
      .map((n) => (n.props as { testID: string }).testID);
    expect(order).toEqual(['project-row-s1', 'project-row-m1', 'project-row-p1']);
    expect(screen.getByText('Trip cut')).toBeTruthy();
    expect(screen.getByTestId('project-thumb-s1').props.source).toMatchObject({
      uri: expect.stringContaining('/studio/assets/vid-1/sprite'),
    });
    expect(screen.getByTestId('project-duration-s1')).toBeTruthy();
    expect(screen.getAllByText('Darkroom').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Motion').length).toBeGreaterThan(0);
  });

  it('one failing source shows its own error line; the others still list', async () => {
    fake.photo = [photo('p1', 'Beach', 5)];
    fake.vector = [vector('m1', 'Logo', 3)];
    fake.fail.add('studio');
    await mountProjects();
    expect(await screen.findByTestId('projects-error-darkroom')).toBeTruthy();
    expect(screen.getByText("Couldn't load your Darkroom projects.")).toBeTruthy();
    expect(await screen.findByTestId('project-row-p1')).toBeTruthy();
    expect(screen.getByTestId('project-row-m1')).toBeTruthy();
    expect(screen.queryByTestId('projects-error-motion')).toBeNull();
    expect(screen.queryByTestId('projects-error-aperture')).toBeNull();
  });

  it('the filter chip narrows the list, reports projects_filter_changed and is remembered', async () => {
    fake.photo = [photo('p1', 'Beach', 5)];
    fake.studio = [studio('s1', 'Trip cut', 1)];
    fake.vector = [vector('m1', 'Logo', 3)];
    const { unmount } = await mountProjects();
    await screen.findByTestId('project-row-s1');
    await fireEvent.press(screen.getByTestId('projects-filter-motion'));
    await waitFor(() => expect(screen.queryByTestId('project-row-s1')).toBeNull());
    expect(screen.getByTestId('project-row-m1')).toBeTruthy();
    expect(screen.queryByTestId('project-row-p1')).toBeNull();
    expect(track).toHaveBeenCalledWith('projects_filter_changed', { filter: 'motion' });
    expect(await loadProjectsFilter()).toBe('motion');
    unmount();
    await mountProjects();
    await screen.findByTestId('project-row-m1');
    await act(async () => undefined);
    expect(screen.queryByTestId('project-row-s1')).toBeNull();
  });

  it('Motion: the menu has Open on the web only, which opens the editor URL', async () => {
    fake.vector = [vector('m1', 'Logo', 3)];
    await mountProjects();
    await fireEvent.press(await screen.findByTestId('project-menu-m1'));
    expect(await screen.findByTestId('project-actions-sheet')).toBeTruthy();
    expect(screen.queryByTestId('project-action-export')).toBeNull();
    await fireEvent.press(screen.getByTestId('project-action-web'));
    expect(openWebPage).toHaveBeenCalledWith('https://www.media-manipulator.com/motion/m1');
  });

  it('Darkroom: the menu reports studio_project_opened (app_list) and offers Export, Exports, web', async () => {
    fake.studio = [studio('s1', 'Trip cut', 1)];
    await mountProjects();
    await fireEvent.press(await screen.findByTestId('project-row-s1'));
    expect(await screen.findByTestId('project-action-export')).toBeTruthy();
    expect(screen.getByTestId('project-action-exports')).toBeTruthy();
    expect(track).toHaveBeenCalledWith(
      'studio_project_opened',
      { host: 'mm', surface: 'app_list' },
      expect.objectContaining({ tool_slug: 'darkroom' }),
    );
    await fireEvent.press(screen.getByTestId('project-action-web'));
    expect(openWebPage).toHaveBeenCalledWith(
      'https://www.media-manipulator.com/tools/content-studio',
    );
    // No delete on Darkroom/Motion rows in phase 0.
    expect(screen.queryByTestId('project-delete-s1')).toBeNull();
  });

  it('shows the all-products empty state when nothing exists', async () => {
    await mountProjects();
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });
});
