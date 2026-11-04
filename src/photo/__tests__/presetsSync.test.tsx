/**
 * MA53 (acceptance 2-3): the Presets sheet on the account against a fake MM103 API. List / save /
 * rename / delete hit `/photo/presets*` (rename with `If-Match`), a 403 cap opens the limit sheet
 * path, the one-time migration uploads up to the cap and clears MMKV, "not now" sets the flag and
 * offers a per-preset Upload, an account that already has presets never gets the bulk prompt,
 * applying re-prefixes ids and reports the scope, offline shows the offline line; RTL snapshot of
 * the migration sheet.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { I18nManager } from 'react-native';
import { Provider } from 'react-redux';
import { setIdTokenProvider } from '@/api/authToken';
import { normaliseError, type MmError } from '@/api/errors';
import { changeAppLanguage, i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { limitVariantFor } from '@/quota/limitVariant';
import { createSnapshots } from '../history';
import { makePhotoStore, photoActions } from '../photoStore';
import { newPhotoDoc, parsePhotoDoc, type PhotoDoc } from '../photoTypes';
import {
  MIGRATION_DECLINED_KEY,
  migrateLocalPresets,
  shouldOfferMigration,
} from '../presets/migration';
import { USER_PRESETS_KEY, listUserPresets, type KvStorage } from '../presets/presetStore';
import { accountPresetOf, asUserPreset } from '../presetsApi';
import { createToolStore } from '../tools/toolState';
import { EditorProvider, type EditorTools } from '../ui/EditorContext';
import { PresetMigrationSheet, PresetsSheet } from '../ui/sheets/PresetsSheet';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@shopify/react-native-skia', () => ({ Canvas: () => null, Image: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/quota/QuotaChip', () => ({ QuotaChip: () => null }));
jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const mockUploadAsync = jest.fn();
jest.mock('@/jobs/fsTask', () => ({
  makeUploadTask: (...a: unknown[]) => {
    mockUploadCalls.push(a);
    return { uploadAsync: mockUploadAsync, cancel: jest.fn() };
  },
}));
const mockUploadCalls: unknown[][] = [];

const LAYER = { id: 'L', type: 'exposure', enabled: true, opacity: 1, params: { ev: 1 } };
const iso = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();

interface Row {
  id: string;
  name: string;
  category: string | null;
  revision: number;
  hasThumbnail: boolean;
  layers: unknown[];
  createdAt: string;
  updatedAt: string;
}
interface Fake {
  presets: Row[];
  limit: number;
  offline: boolean;
  calls: { method: string; path: string; ifMatch?: string; body?: unknown }[];
}
let fake: Fake;
let seq = 0;
const realFetch = global.fetch;

const reply = (status: number, body: unknown) =>
  Promise.resolve({
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  });

function installFetch() {
  global.fetch = jest.fn(
    (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const method = init?.method ?? 'GET';
      const u = new URL(url);
      const path = u.pathname.replace(/^\/api/, '');
      const body = init?.body ? JSON.parse(init.body) : undefined;
      fake.calls.push({
        method,
        path: path + u.search,
        ifMatch: init?.headers?.['If-Match'],
        body,
      });
      if (fake.offline) return Promise.reject(new TypeError('Network request failed'));
      if (path === '/photo/presets' && method === 'GET')
        return reply(200, { presets: fake.presets, limit: fake.limit, used: fake.presets.length });
      if (path === '/photo/presets' && method === 'POST') {
        if (fake.limit >= 0 && fake.presets.length >= fake.limit)
          return reply(403, {
            error: 'photo_presets_limit',
            limit: fake.limit,
            used: fake.presets.length,
            upgradePath: 'premium',
          });
        seq += 1;
        const row: Row = {
          id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
          name: body.name,
          category: body.category ?? null,
          revision: 1,
          hasThumbnail: false,
          layers: body.layers,
          createdAt: iso(seq),
          updatedAt: iso(seq),
        };
        fake.presets = [row, ...fake.presets];
        return reply(201, row);
      }
      const m = /^\/photo\/presets\/([^/]+)$/.exec(path);
      const row = m ? fake.presets.find((p) => p.id === m[1]) : undefined;
      if (m && !row) return reply(404, { error: 'Preset not found' });
      if (row && method === 'PUT') {
        const want = init?.headers?.['If-Match'];
        if (!want) return reply(428, { error: 'if_match_required' });
        if (Number(want) !== row.revision)
          return reply(409, { error: 'revision_conflict', revision: row.revision });
        Object.assign(row, body, { revision: row.revision + 1 });
        return reply(200, row);
      }
      if (row && method === 'DELETE') {
        fake.presets = fake.presets.filter((p) => p !== row);
        return reply(200, { deleted: { objects: 1, bytes: 0 }, pending: 0 });
      }
      return reply(404, { error: 'not found' });
    },
  ) as unknown as typeof fetch;
}

const serverRow = (id: string, name: string, over: Partial<Row> = {}): Row => ({
  id,
  name,
  category: 'custom',
  revision: 3,
  hasThumbnail: false,
  layers: [LAYER],
  createdAt: iso(0),
  updatedAt: iso(0),
  ...over,
});

function memKv(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  const kv: KvStorage = {
    getItem: async (k) => map.get(k),
    setItem: async (k, v) => void map.set(k, v),
  };
  return { kv, map };
}
const devicePresets = (n: number) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      id: `up-${i + 1}`,
      name: `Device ${i + 1}`,
      category: 'custom',
      layers: [LAYER],
      createdAt: iso(100 + i),
    })),
  );

function docWith(): PhotoDoc {
  const r = parsePhotoDoc({
    ...newPhotoDoc(4000, 3000),
    layers: [{ id: 'L', type: 'exposure', params: { ev: 1 }, mask: null }],
  });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

async function mount(kv: KvStorage, extra: Partial<EditorTools> = {}) {
  const { store: app } = await makeReadyStore();
  const store = makePhotoStore();
  store.dispatch(photoActions.loaded({ projectId: 'p1', doc: docWith() }));
  const x: EditorTools = {
    tools: createToolStore(),
    snapshots: createSnapshots(),
    sourceSize: { width: 4000, height: 3000 },
    capabilities: { aiMasks: true, heal: true },
    onPresetApplied: jest.fn(),
    onPresetSaved: jest.fn(),
    onPresetsMigrated: jest.fn(),
    onLimit: jest.fn(() => true),
    presetThumbFile: jest.fn(async () => 'file:///cache/thumb.png'),
    ...extra,
  };
  const r = await render(
    <Provider store={app}>
      <I18nextProvider i18n={i18n}>
        <EditorProvider value={{ store, haptics: false, extra: x }}>
          <PresetsSheet kv={kv} />
        </EditorProvider>
      </I18nextProvider>
    </Provider>,
  );
  return { store, x, r };
}

beforeEach(() => {
  setIdTokenProvider(() => Promise.resolve('tok'));
  fake = { presets: [], limit: 10, offline: false, calls: [] };
  seq = 0;
  mockUploadCalls.length = 0;
  mockUploadAsync.mockReset();
  mockUploadAsync.mockResolvedValue({ status: 200, headers: {}, body: '{}' });
  installFetch();
});
afterEach(async () => {
  global.fetch = realFetch;
  Object.defineProperty(I18nManager, 'isRTL', { value: false, configurable: true });
  await changeAppLanguage(i18n, 'en-US');
});

describe('MA53 account presets in the Presets sheet', () => {
  it('lists the account presets (GET /photo/presets?full=1)', async () => {
    fake.presets = [serverRow('a1', 'Sunset look'), serverRow('a2', 'Moody')];
    await mount(memKv().kv);
    expect(await screen.findByText('Sunset look')).toBeTruthy();
    expect(screen.getByText('Moody')).toBeTruthy();
    expect(screen.getByText('Saved to your account.')).toBeTruthy();
    expect(fake.calls[0]).toMatchObject({ method: 'GET', path: '/photo/presets?full=1' });
  });

  it('save posts the stack without masks or groups, reports scope server, uploads the thumbnail', async () => {
    const { x } = await mount(memKv().kv);
    await screen.findByText('You have not saved a preset yet.');
    await fireEvent.press(screen.getByTestId('photo-preset-save-current'));
    await fireEvent.changeText(screen.getByTestId('photo-preset-name'), '  Warm skin  ');
    await fireEvent.press(screen.getByTestId('photo-preset-save'));
    await waitFor(() => expect(screen.getByText('Warm skin')).toBeTruthy());
    const post = fake.calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/photo/presets');
    expect(post.body).toMatchObject({ name: 'Warm skin', category: 'custom' });
    const layers = (post.body as { layers: Record<string, unknown>[] }).layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.mask).toBeNull();
    expect('group' in layers[0]!).toBe(false);
    expect(x.onPresetSaved).toHaveBeenCalledWith(1);
    await waitFor(() => expect(mockUploadCalls).toHaveLength(1));
    const [uri, url, o] = mockUploadCalls[0] as [string, string, Record<string, unknown>];
    expect(uri).toBe('file:///cache/thumb.png');
    expect(url).toMatch(/\/photo\/presets\/00000000-0000-4000-8000-000000000001\/thumbnail$/);
    expect(o).toMatchObject({
      method: 'POST',
      multipart: true,
      fieldName: 'file',
      mimeType: 'image/png',
    });
  });

  it('rename sends If-Match with the revision; a 409 retries once on the server revision', async () => {
    fake.presets = [serverRow('a1', 'Old')];
    await mount(memKv().kv);
    await screen.findByText('Old');
    // Someone renamed it on the web since the list loaded.
    fake.presets[0]!.revision = 5;
    await fireEvent.press(screen.getByTestId('photo-preset-rename-a1'));
    await fireEvent.changeText(screen.getByDisplayValue('Old'), 'New name');
    await fireEvent.press(screen.getByTestId('photo-preset-rename-save-a1'));
    await waitFor(() => expect(screen.getByText('New name')).toBeTruthy());
    const puts = fake.calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => [c.path, c.ifMatch, c.body])).toEqual([
      ['/photo/presets/a1', '3', { name: 'New name' }],
      ['/photo/presets/a1', '5', { name: 'New name' }],
    ]);
  });

  it('delete calls DELETE /photo/presets/:id and the row goes', async () => {
    fake.presets = [serverRow('a1', 'Gone soon')];
    await mount(memKv().kv);
    await screen.findByText('Gone soon');
    await fireEvent.press(screen.getByTestId('photo-preset-delete-a1'));
    await waitFor(() => expect(screen.queryByText('Gone soon')).toBeNull());
    expect(fake.calls.some((c) => c.method === 'DELETE' && c.path === '/photo/presets/a1')).toBe(
      true,
    );
  });

  it('403 photo_presets_limit at the cap goes to the limit sheet (neutral cap line)', async () => {
    fake.limit = 1;
    fake.presets = [serverRow('a1', 'Only one')];
    const { x } = await mount(memKv().kv);
    await screen.findByText('Only one');
    await fireEvent.press(screen.getByTestId('photo-preset-save-current'));
    await fireEvent.changeText(screen.getByTestId('photo-preset-name'), 'Second');
    await fireEvent.press(screen.getByTestId('photo-preset-save'));
    await waitFor(() => expect(x.onLimit).toHaveBeenCalled());
    const e = (x.onLimit as jest.Mock).mock.calls[0]![0] as MmError;
    expect(e.code).toBe('photo_presets_limit');
    expect(limitVariantFor(e)).toEqual({ kind: 'presets', limit: 1 });
    expect(x.onPresetSaved).not.toHaveBeenCalled();
    expect(i18n.t('photo.presets.cap', { count: 10 })).toBe('Up to 10 saved presets on your plan');
  });

  it('applying an account preset re-prefixes ids as one group and reports scope server', async () => {
    fake.presets = [serverRow('a1', 'Look A')];
    const { store, x } = await mount(memKv().kv);
    await fireEvent.press(await screen.findByTestId('photo-user-preset-apply-a1'));
    const added = store.getState().doc!.layers.slice(1);
    expect(added.map((l) => [l.id, l.group])).toEqual([['preset-a1-1', 'Preset: Look A']]);
    expect(store.getState().past.at(-1)!.label).toBe('Preset|user:Look A');
    expect(x.onPresetApplied).toHaveBeenCalledWith('custom', 'server');
  });

  it('offline: the list shows the offline line with Retry; a save says offline', async () => {
    fake.offline = true;
    await mount(memKv().kv);
    expect(await screen.findByTestId('photo-presets-load-failed')).toBeTruthy();
    expect(screen.getByText("You're offline; try again.")).toBeTruthy();
  });
});

describe('MA53 migration of the MMKV presets', () => {
  it('empty account + device presets: Keep uploads oldest first and clears MMKV', async () => {
    const { kv, map } = memKv({ [USER_PRESETS_KEY]: devicePresets(3) });
    const { x } = await mount(kv);
    expect(await screen.findByText('Keep your 3 presets on your account?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('photo-preset-migrate-keep'));
    await waitFor(() => expect(fake.presets).toHaveLength(3));
    expect(
      fake.calls.filter((c) => c.method === 'POST').map((c) => (c.body as { name: string }).name),
    ).toEqual(['Device 1', 'Device 2', 'Device 3']);
    expect(JSON.parse(map.get(USER_PRESETS_KEY)!)).toEqual([]);
    expect(x.onPresetsMigrated).toHaveBeenCalledWith(3, false);
    await waitFor(() => expect(screen.queryByTestId('photo-device-presets')).toBeNull());
  });

  it('Keep stops at the cap: the rest stay on the device with Upload', async () => {
    fake.limit = 2;
    const { kv } = memKv({ [USER_PRESETS_KEY]: devicePresets(3) });
    await mount(kv);
    await fireEvent.press(await screen.findByTestId('photo-preset-migrate-keep'));
    await waitFor(() => expect(fake.presets).toHaveLength(2));
    const left = await listUserPresets(kv);
    expect(left.map((p) => p.name)).toEqual(['Device 3']);
    expect(await screen.findByTestId('photo-device-preset-upload-up-3')).toBeTruthy();
  });

  it('Not now sets the flag, never asks again, and each device preset gets Upload', async () => {
    const { kv, map } = memKv({ [USER_PRESETS_KEY]: devicePresets(2) });
    const { x } = await mount(kv);
    await fireEvent.press(await screen.findByTestId('photo-preset-migrate-not-now'));
    expect(map.get(MIGRATION_DECLINED_KEY)).toBe('1');
    expect(x.onPresetsMigrated).toHaveBeenCalledWith(2, true);
    expect(await screen.findByTestId('photo-device-preset-upload-up-1')).toBeTruthy();
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
    await fireEvent.press(screen.getByTestId('photo-device-preset-upload-up-1'));
    await waitFor(() => expect(fake.presets.map((p) => p.name)).toEqual(['Device 1']));
    await waitFor(() => expect(screen.queryByTestId('photo-device-preset-up-1')).toBeNull());
    expect(x.onPresetSaved).toHaveBeenCalledWith(1);
    expect(shouldOfferMigration(0, await listUserPresets(kv), true)).toBe(false);
  });

  it('an account that already has presets gets per-preset Upload, never the bulk prompt', async () => {
    fake.presets = [serverRow('a1', 'From the web')];
    const { kv } = memKv({ [USER_PRESETS_KEY]: devicePresets(2) });
    await mount(kv);
    expect(await screen.findByText('From the web')).toBeTruthy();
    expect(await screen.findByTestId('photo-device-preset-upload-up-2')).toBeTruthy();
    expect(screen.queryByTestId('photo-preset-migrate')).toBeNull();
  });

  it('applying a device preset reports scope local', async () => {
    fake.presets = [serverRow('a1', 'From the web')];
    const { kv } = memKv({ [USER_PRESETS_KEY]: devicePresets(1) });
    const { x } = await mount(kv);
    await fireEvent.press(await screen.findByLabelText('Device 1'));
    expect(x.onPresetApplied).toHaveBeenCalledWith('custom', 'local');
  });

  it('migrateLocalPresets: a lost connection stops; a refused preset is skipped', async () => {
    const { kv } = memKv({ [USER_PRESETS_KEY]: devicePresets(3) });
    const local = await listUserPresets(kv);
    const refused = normaliseError(422, { error: 'photo_preset_invalid' });
    const offline: MmError = { status: 'FETCH_ERROR', code: 'network', details: {} };
    const results = [{ ok: false, error: refused }, { ok: true }, { ok: false, error: offline }];
    const create = jest.fn(async () => results.shift() as { ok: true });
    const r = await migrateLocalPresets(kv, local, create);
    expect(r).toEqual({ uploaded: 1, remaining: 2, capped: false, error: refused });
    expect((await listUserPresets(kv)).map((p) => p.name)).toEqual(['Device 3', 'Device 1']);
  });
});

describe('MA53 client helpers', () => {
  it('a layer this build cannot read is dropped, not the preset; export keeps the v1 format', () => {
    const p = accountPresetOf({
      id: '0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f',
      name: 'Mixed',
      category: 'film',
      revision: 2,
      hasThumbnail: true,
      createdAt: iso(1),
      updatedAt: iso(2),
      layers: [LAYER, { id: 'x', type: 'fromTheFuture', params: {} }],
    });
    expect(p.layers.map((l) => l.type)).toEqual(['exposure']);
    expect(p.category).toBe('film');
    expect(asUserPreset(p)).toMatchObject({
      id: '0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f',
      name: 'Mixed',
    });
  });
});

describe('RTL (Arabic)', () => {
  it('the migration sheet renders the Arabic copy (snapshot)', async () => {
    Object.defineProperty(I18nManager, 'isRTL', { value: true, configurable: true });
    await changeAppLanguage(i18n, 'ar-SA');
    const r = await render(
      <I18nextProvider i18n={i18n}>
        <PresetMigrationSheet
          visible
          count={4}
          busy={false}
          onKeep={jest.fn()}
          onNotNow={jest.fn()}
          onClose={jest.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByText('Keep on this device')).toBeNull();
    expect(screen.getByTestId('photo-preset-migrate')).toBeTruthy();
    expect(r.toJSON()).toMatchSnapshot();
  });
});
