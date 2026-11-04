/**
 * MA52 decisions 3-4: History's Aperture rows (label, icon, photo_heal hidden), Edit again on an
 * export's result (200 shows, 404 hides), and the Projects segment (lists, opens, deletes) against
 * a fake API.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import HistoryTab from '../../../app/(app)/(tabs)/history';
import { track } from '@/analytics/track';
import { setIdTokenProvider } from '@/api/authToken';
import { i18n } from '@/i18n';
import { exportProjectId } from '@/photo/editAgain';
import { EditAgainButton } from '@/photo/ui/EditAgainButton';
import { thumbUri } from '@/photo/ui/ProjectsList';
import { makeReadyStore } from '@/state/testing';
import { flattenHistory } from '../cacheOps';
import { isHiddenInHistory, toolLabel } from '../toolLabel';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), navigate: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
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

const PID = '0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f';
const PID2 = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const entry = (id: string, over: Record<string, unknown> = {}) => ({
  jobId: id,
  tool: 'photo_export',
  mode: 'jpg',
  mediaKind: 'image',
  sourceFormat: 'jpg',
  targetFormat: 'jpg',
  status: 'completed',
  createdAt: iso(0),
  expired: false,
  deletesOn: iso(-5),
  downloadPath: `/download/${id}`,
  ...over,
});
const project = (id: string, name: string) => ({
  id,
  name,
  revision: 3,
  status: 'ready',
  width: 4000,
  height: 3000,
  hasAlpha: false,
  originalBytes: 3_500_000,
  originalExt: 'jpg',
  thumbUrl: `/api/photo/projects/${id}/thumb`,
  createdAt: iso(2),
  updatedAt: iso(1),
});

interface Fake {
  history: ReturnType<typeof entry>[];
  projects: ReturnType<typeof project>[];
  /** GET /photo/projects/:id status. */
  projectStatus: number;
  capabilities: Record<string, unknown>;
  calls: { method: string; url: string }[];
}
let fake: Fake;
const realFetch = global.fetch;

function json(status: number, body: unknown) {
  return Promise.resolve({
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function installFetch() {
  global.fetch = jest.fn((url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    fake.calls.push({ method, url });
    const path = new URL(url).pathname.replace(/^\/api/, '');
    if (path === '/account/history')
      return json(200, { entries: fake.history, total: fake.history.length, limit: 50, offset: 0 });
    if (path === '/photo/capabilities') return json(200, fake.capabilities);
    if (path === '/photo/projects' && method === 'GET')
      return json(200, { projects: fake.projects });
    const m = /^\/photo\/projects\/([^/]+)$/.exec(path);
    if (m && method === 'DELETE') {
      fake.projects = fake.projects.filter((p) => p.id !== m[1]);
      return json(200, { deleted: { objects: 3, bytes: 10 }, pending: 0 });
    }
    if (m && method === 'GET')
      return fake.projectStatus === 200
        ? json(200, { project: project(m[1]!, 'Beach'), doc: {} })
        : json(fake.projectStatus, { error: 'Project not found' });
    return json(404, { error: 'not found' });
  }) as unknown as typeof fetch;
}

async function mount(ui: React.ReactElement) {
  const { store } = await makeReadyStore();
  const utils = await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
  return { store, ...utils };
}

beforeEach(() => {
  setIdTokenProvider(() => Promise.resolve('tok'));
  (track as jest.Mock).mockClear();
  mockPush.mockClear();
  fake = {
    history: [],
    projects: [],
    projectStatus: 200,
    capabilities: { enabled: true, render: true, heal: true },
    calls: [],
  };
  installFetch();
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('History: Aperture rows (MA52 decision 3)', () => {
  it('a photo_export row reads "Aperture export" with the Aperture row (icon)', async () => {
    expect(toolLabel({ tool: 'photo_export', mode: 'jpg', mediaKind: 'image' })).toEqual({
      toolId: 'aperture',
      key: 'history.tool.photo_export',
    });
    fake.history = [entry('exp-1')];
    await mount(<HistoryTab />);
    expect(await screen.findByTestId('history-row-exp-1')).toBeTruthy();
    expect(screen.getByText('Aperture export')).toBeTruthy();
  });

  it('photo_heal jobs are filtered out of the list', async () => {
    expect(isHiddenInHistory({ tool: 'photo_heal' })).toBe(true);
    expect(isHiddenInHistory({ tool: 'photo_export' })).toBe(false);
    const data = {
      pages: [
        {
          entries: [entry('h1', { tool: 'photo_heal', mode: 'heal' }), entry('e1')] as never,
          total: 2,
        },
      ],
      pageParams: [0],
    };
    expect(flattenHistory(data).map((e) => e.jobId)).toEqual(['e1']);
    fake.history = [entry('h1', { tool: 'photo_heal', mode: 'heal' }), entry('e1')];
    await mount(<HistoryTab />);
    expect(await screen.findByTestId('history-row-e1')).toBeTruthy();
    expect(screen.queryByTestId('history-row-h1')).toBeNull();
  });
});

describe('Edit again (MA52 decision 3)', () => {
  const job = (options: Record<string, unknown>) =>
    ({
      id: 'srv-1',
      status: 'completed',
      originalFile: { name: 'a.jpg', size: 1, type: 'image/jpeg' },
      options,
      createdAt: iso(0),
    }) as never;

  it('reads the project id from options.projectId of a photo_export job only', () => {
    expect(exportProjectId(job({ tool: 'photo_export', projectId: PID }))).toBe(PID);
    expect(exportProjectId(job({ tool: 'photo_export', sourcePath: 'x' }))).toBeNull();
    expect(exportProjectId(job({ tool: 'photo_heal', projectId: PID }))).toBeNull();
    expect(exportProjectId(job({ tool: 'photo_export', projectId: '../x' }))).toBeNull();
    expect(exportProjectId(job({}))).toBeNull();
  });

  it('is shown on 200 and opens the project in the editor (from=history, the export slug)', async () => {
    await mount(
      <EditAgainButton
        job={job({ tool: 'photo_export', projectId: PID })}
        toolSlug="black-and-white-photo"
      />,
    );
    fireEvent.press(await screen.findByTestId('result-edit-again'));
    expect(mockPush).toHaveBeenCalledWith(
      `/(app)/photo/${PID}?from=history&slug=black-and-white-photo`,
    );
    expect(fake.calls).toContainEqual({
      method: 'GET',
      url: expect.stringMatching(new RegExp(`/photo/projects/${PID}$`)),
    });
  });

  it('is hidden on 404 (the project was deleted)', async () => {
    fake.projectStatus = 404;
    await mount(<EditAgainButton job={job({ tool: 'photo_export', projectId: PID })} />);
    await waitFor(() =>
      expect(fake.calls.some((c) => c.url.endsWith(`/photo/projects/${PID}`))).toBe(true),
    );
    await act(async () => undefined);
    expect(screen.queryByTestId('result-edit-again')).toBeNull();
  });

  it('is never queried for a job that is not a project export', async () => {
    await mount(<EditAgainButton job={job({ format: 'png' })} />);
    await act(async () => undefined);
    expect(screen.queryByTestId('result-edit-again')).toBeNull();
    expect(fake.calls.some((c) => c.url.includes('/photo/projects/'))).toBe(false);
  });
});

describe('History: Projects segment (MA52 decision 4)', () => {
  async function openProjects() {
    const utils = await mount(<HistoryTab />);
    fireEvent.press(await screen.findByText('Projects'));
    return utils;
  }

  it('lists the projects with name, last edit and size; thumbnails carry auth headers', async () => {
    fake.projects = [project(PID, 'Beach'), project(PID2, '')];
    await openProjects();
    expect(await screen.findByTestId(`project-row-${PID}`)).toBeTruthy();
    expect(screen.getByText('Beach')).toBeTruthy();
    expect(screen.getByText('Untitled photo')).toBeTruthy();
    expect(screen.getAllByText('4000 × 3000 px')).toHaveLength(2);
    expect(screen.getAllByText(/^Edited /)).toHaveLength(2);
    expect(thumbUri(fake.projects[0]!)).toBe(
      `https://api.media-manipulator.com/api/photo/projects/${PID}/thumb`,
    );
  });

  it('tap opens the editor with from=projects', async () => {
    fake.projects = [project(PID, 'Beach')];
    await openProjects();
    fireEvent.press(await screen.findByTestId(`project-row-${PID}`));
    expect(mockPush).toHaveBeenCalledWith(`/(app)/photo/${PID}?from=projects`);
  });

  it('delete asks first, then DELETEs, reports data_deleted kind project and refreshes', async () => {
    fake.projects = [project(PID, 'Beach'), project(PID2, 'Dog')];
    await openProjects();
    // The swipe action (mocked away here) and a long press open the same confirm.
    fireEvent(await screen.findByTestId(`project-row-${PID}`), 'longPress');
    expect(await screen.findByText('Delete this project?')).toBeTruthy();
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.press(screen.getByTestId('project-delete-confirm'));
    await waitFor(() => expect(screen.queryByTestId(`project-row-${PID}`)).toBeNull());
    expect(screen.getByTestId(`project-row-${PID2}`)).toBeTruthy();
    expect(fake.calls).toContainEqual({
      method: 'DELETE',
      url: expect.stringMatching(new RegExp(`/photo/projects/${PID}$`)),
    });
    expect(track).toHaveBeenCalledWith(
      'data_deleted',
      { scope: 'item', kind: 'project' },
      expect.objectContaining({ tool_slug: 'aperture' }),
    );
  });

  it('shows the empty state', async () => {
    await openProjects();
    expect(await screen.findByText('No Aperture projects yet')).toBeTruthy();
  });

  it('the segment is hidden when Aperture is off for the account', async () => {
    fake.capabilities = { enabled: false, render: false };
    fake.history = [entry('e1')];
    await mount(<HistoryTab />);
    await screen.findByTestId('history-row-e1');
    await waitFor(() => expect(screen.queryByText('Projects')).toBeNull());
  });
});
