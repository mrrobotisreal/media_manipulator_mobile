/**
 * MA52 decision 1-2: the sixteen Aperture entry rows (MM100 page slugs), their launcher params,
 * the heal capability, search, intake ordering, and the entry look applied on open.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { toolsForKinds } from '@/files/intakeTools';
import { setIntakeBatch } from '@/files/session';
import type { IntakeFile } from '@/files/types';
import { applyEntryPreset } from '@/photo/entry';
import { APERTURE_PRESET_ROWS } from '@/photo/entryRows';
import { takePhotoOpenRequest } from '@/photo/openRequest';
import { makePhotoStore, photoActions } from '@/photo/photoStore';
import { newPhotoDoc } from '@/photo/photoTypes';
import { WEB_PHOTO_SLUGS } from '../__fixtures__/webTools';
import { isToolAvailable } from '../availability';
import { TOOL_BY_ID, TOOLS, toolsByFamily } from '../registry';
import { resolveTransport } from '../resolveTransport';
import { searchTools, type SearchableTool } from '../search';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/photo/projectsApi', () => ({
  useGetPhotoCapabilitiesQuery: () => ({ data: { enabled: true, render: true, heal: true } }),
}));

/** Ticket decision 1, verbatim: id -> [web slug, panel (app strip id), preset]. */
const TICKET: Record<string, [string, string, string?]> = {
  'aperture-brighten': ['brighten-image', 'basic'],
  'aperture-contrast': ['adjust-image-contrast', 'basic'],
  'aperture-exposure': ['fix-photo-exposure', 'basic'],
  'aperture-hue': ['adjust-image-hue', 'color'],
  'aperture-color-pop': ['color-pop', 'color', 'color-pop-red'],
  'aperture-black-white': ['black-and-white-photo', 'bw', 'bw-film'],
  'aperture-curves': ['photo-curves', 'curves'],
  'aperture-levels': ['photo-levels', 'levels'],
  'aperture-white-balance': ['white-balance-photo', 'basic'],
  'aperture-straighten': ['straighten-photo', 'geometry'],
  'aperture-perspective': ['fix-perspective-photo', 'geometry'],
  'aperture-blemishes': ['remove-blemishes', 'heal'],
  'aperture-select-color': ['select-by-color', 'masks'],
  'aperture-sharpen': ['sharpen-photo-online', 'detail'],
  'aperture-noise': ['reduce-image-noise', 'detail'],
  'aperture-vignette': ['add-vignette', 'detail'],
};

const en = JSON.parse(readFileSync(join(__dirname, '../../../locales/en-us/app.json'), 'utf8'));
const lookup = (key: string): unknown => key.split('.').reduce((o: any, k) => o?.[k], en);

const photo = (id: string, source: IntakeFile['source'] = 'picker'): IntakeFile => ({
  id,
  uri: `file:///c/${id}.jpg`,
  name: `${id}.jpg`,
  extension: 'jpg',
  mimeType: 'image/jpeg',
  mediaKind: 'image',
  sizeBytes: 2048,
  width: 400,
  height: 300,
  source,
  copiedAt: 1,
});

beforeEach(() => {
  mockPush.mockClear();
  takePhotoOpenRequest();
});

describe('Aperture entry rows (MA52)', () => {
  it('are the sixteen rows of decision 1, in that order, under Image', () => {
    expect(APERTURE_PRESET_ROWS.map((r) => r.id)).toEqual(Object.keys(TICKET));
    const image = toolsByFamily('image').map((t) => t.id);
    for (const id of Object.keys(TICKET)) expect(image).toContain(id);
  });

  it('every row: ops, photoProject, no GPU, launcher, own title, analyticsSlug = the MM100 slug', () => {
    for (const [id, [slug, panel, preset]] of Object.entries(TICKET)) {
      const t = TOOL_BY_ID.get(id)!;
      expect(t).toMatchObject({
        family: 'image',
        metric: 'ops',
        endpoint: 'photoProject',
        gpu: false,
        noRunButton: true,
        analyticsSlug: slug,
        webTask: 'aperture',
      });
      expect(WEB_PHOTO_SLUGS).toContain(slug);
      expect(resolveTransport(t, 'image')).toBe('photoProject');
      expect(t.defaults).toEqual(preset ? { panel, preset } : { panel });
      expect(t.accepts).toEqual(TOOL_BY_ID.get('aperture')!.accepts);
      expect(t.titleKey).toMatch(/^tools\.aperture\.[a-z-]+\.title$/);
      expect(typeof lookup(t.titleKey)).toBe('string');
      expect(typeof lookup(t.descriptionKey)).toBe('string');
    }
    const slugs = TOOLS.map((t) => t.analyticsSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(Object.entries(TICKET))(
    '%s opens the editor with its panel and preset (navigation mock)',
    async (id, [slug, panel, preset]) => {
      const t = TOOL_BY_ID.get(id)!;
      setIntakeBatch({ files: [photo(`p-${id}`)], rejected: [] });
      const { Form } = t;
      const r = await render(
        <I18nextProvider i18n={i18n}>
          <Form
            value={t.defaults}
            onChange={() => undefined}
            ctx={{
              input: {
                id: `p-${id}`,
                name: 'x.jpg',
                extension: 'jpg',
                mime: 'image/jpeg',
                mediaKind: 'image',
              },
            }}
          />
        </I18nextProvider>,
      );
      await fireEvent.press(r.getByTestId('photo-open-editor'));
      expect(mockPush).toHaveBeenLastCalledWith('/(app)/photo/new');
      const req = takePhotoOpenRequest()!;
      expect(req).toMatchObject({ source: 'app_intake', toolSlug: slug, panel });
      expect(req.preset).toBe(preset);
    },
  );

  it('a shared photo opened from a row reports app_share', async () => {
    const t = TOOL_BY_ID.get('aperture-curves')!;
    setIntakeBatch({ files: [photo('s1', 'share')], rejected: [] });
    const r = await render(
      <I18nextProvider i18n={i18n}>
        <t.Form
          value={t.defaults}
          onChange={() => undefined}
          ctx={{
            input: {
              id: 's1',
              name: 'x',
              extension: 'jpg',
              mime: 'image/jpeg',
              mediaKind: 'image',
            },
          }}
        />
      </I18nextProvider>,
    );
    await fireEvent.press(r.getByTestId('photo-open-editor'));
    expect(takePhotoOpenRequest()).toMatchObject({ source: 'app_share', toolSlug: 'photo-curves' });
  });

  it('aperture-blemishes is hidden when capabilities.heal is false; the others stay', () => {
    const caps = (heal: boolean) => ({ photo: { enabled: true, render: true, heal } });
    const blem = TOOL_BY_ID.get('aperture-blemishes')!;
    expect(isToolAvailable(blem, caps(false))).toBe(false);
    expect(isToolAvailable(blem, caps(true))).toBe(true);
    expect(isToolAvailable(blem, {})).toBe(true);
    expect(isToolAvailable(blem, { photo: { enabled: false, render: true, heal: true } })).toBe(
      false,
    );
    for (const id of Object.keys(TICKET).filter((x) => x !== 'aperture-blemishes'))
      expect(isToolAvailable(TOOL_BY_ID.get(id)!, caps(false))).toBe(true);
  });

  it('search "black" finds Black & white photo; "straighten" and "brighten" find theirs', () => {
    const items: SearchableTool[] = TOOLS.map((tool) => ({
      tool,
      title: String(lookup(tool.titleKey)),
      description: String(lookup(tool.descriptionKey)),
      englishTitle: String(lookup(tool.titleKey)),
    }));
    const ids = (q: string) => searchTools(items, q).flatMap((s) => s.data.map((d) => d.tool.id));
    expect(ids('black')).toContain('aperture-black-white');
    expect(ids('black and white')).toContain('aperture-black-white');
    expect(ids('straighten')).toContain('aperture-straighten');
    expect(ids('brighten')).toContain('aperture-brighten');
    expect(ids('vignette')).toEqual(['aperture-vignette']);
    expect(String(lookup('tools.aperture.black-white.title'))).toBe('Black & white photo');
  });

  it('intake for photos: recents, then Aperture, then the rest, entry rows last (decision 2)', () => {
    const ids = toolsForKinds(['image'], ['image-compress']).map((t) => t.id);
    expect(ids.slice(0, 2)).toEqual(['image-compress', 'aperture']);
    const firstEntry = ids.findIndex((x) => x.startsWith('aperture-'));
    expect(ids.slice(firstEntry).every((x) => x.startsWith('aperture-'))).toBe(true);
    expect(ids.indexOf('remove-background')).toBeLessThan(firstEntry);
    expect(ids.filter((x) => x.startsWith('aperture-'))).toHaveLength(16);
    // Aperture as a recent keeps its recent slot.
    expect(toolsForKinds(['image'], ['aperture-curves'])[0]!.id).toBe('aperture-curves');
    expect(toolsForKinds(['image'], ['aperture-curves'])[1]!.id).toBe('aperture');
    // Video never lists Aperture.
    expect(toolsForKinds(['video'], []).some((t) => t.id.startsWith('aperture'))).toBe(false);
  });

  it('the entry look is applied once, as one undoable group labelled like the Looks sheet', () => {
    const store = makePhotoStore();
    store.dispatch(photoActions.loaded({ projectId: null, doc: newPhotoDoc(400, 300) }));
    expect(applyEntryPreset(store, 'bw-film', 'Black & white film')).toBe(true);
    const s = store.getState();
    expect(s.doc!.layers.length).toBeGreaterThan(0);
    expect(s.doc!.layers.some((l) => l.type === 'blackWhite')).toBe(true);
    expect(s.past.at(-1)?.label).toBe('Preset|builtin:bw-film');
    expect(applyEntryPreset(store, 'nope', 'x')).toBe(false);
    expect(applyEntryPreset(store, 'auto', 'Auto')).toBe(false); // computed: needs a histogram
  });
});
