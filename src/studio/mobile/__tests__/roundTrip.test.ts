/**
 * Round-trip safety (ticket MA61 decision 7, DARKROOM_MOBILE.md §4, binding): the phone loads,
 * preserves and saves every EDL field, including the ones it cannot edit yet.
 *
 * 1. Every web studio fixture (the synced `studioFixture`, `devSynthetic` output, the caption
 *    goldens' cues and styles, the legacy MM121 project, and a "kitchen sink" project carrying every
 *    v2/v3 field group) goes through parse (the API response schema) -> store -> mutate(no-op) ->
 *    save payload, and the payload must equal the web's `toSaveRequest` of the same document and
 *    keep every field the input had.
 * 2. Each phase-1 edit (trim, split, move, speed, volume, look, transition, title text) may change
 *    only the fields it owns; every other field of the project, its tracks and its clips is
 *    unchanged.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSyntheticProject } from '../../devSynthetic';
import { studioFixture } from '../../fixtures/studioFixture';
import {
  normalizeProject,
  studioCaptionCueSchema,
  studioCaptionStyleSchema,
  studioProjectSchema,
  studioSaveProjectRequestSchema,
  type StudioClip,
  type StudioProject,
  type StudioSaveProjectRequest,
} from '../../studioTypes';
import {
  applyLook,
  moveClip,
  setClipSpeed,
  setClipTransition,
  setClipVolume,
  setTitleText,
  splitAt,
  trimClip,
} from '../edits';
import { toSaveRequest } from '../sessionApi';
import { makeStudioStore, mutate, studioActions, type StudioStore } from '../studioStore';

// --- fixtures ----------------------------------------------------------------

const GOLDENS = join(__dirname, '..', '..', 'captions', 'goldens');
const allGoldenCaptions = readdirSync(GOLDENS)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f.slice(0, -5),
    ...(JSON.parse(readFileSync(join(GOLDENS, f), 'utf8')) as { cues: unknown[]; style: unknown }),
  }));
/**
 * The goldens are inputs to the Go/TS ASS renderer, not stored projects: a few carry renderer-only
 * values the shared Zod model refuses (e.g. `wordsPerGroup: 0` = "unset"), so no saved project can
 * hold them. Those are left out here (and counted, so a new one is noticed).
 */
const goldenCaptions = allGoldenCaptions.filter(
  (g) =>
    studioCaptionStyleSchema.optional().safeParse(g.style ?? undefined).success &&
    studioCaptionCueSchema.array().safeParse(g.cues).success,
);

/** The legacy project of the web's `captions/legacyRoundTrip.test.ts` (MM121). */
const LEGACY = {
  id: 'p',
  name: 'Old',
  schemaVersion: 3,
  fps: 30,
  width: 1920,
  height: 1080,
  durationSeconds: 5,
  tracks: [],
  revision: 3,
  captions: [{ id: 'c1', startSeconds: 0.5, endSeconds: 2.25, text: 'Hello there' }],
  captionStyle: {
    fontSizePct: 5.5,
    color: '#FFCC00',
    backgroundColor: '#101010',
    backgroundOpacity: 0.7,
    position: 'top',
    maxWidthPct: 80,
  },
  captionsEnabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** Every field group the phone cannot edit in phase 1, on top of the web's studioFixture. */
function kitchenSink(): unknown {
  const base = studioFixture();
  const golden = goldenCaptions.find((g) => JSON.stringify(g.cues).includes('"words"'))!;
  const [v1, a1, a2] = base.tracks as [any, any, any];
  return {
    ...base,
    revision: 12,
    tracks: [
      {
        ...v1,
        name: 'Main',
        hidden: false,
        clips: [
          {
            ...v1.clips[0],
            volume: 0.8,
            opacity: 0.9,
            adjustments: { brightness: 0.1, contrast: 1.1, saturation: 0.9 },
            textOverlays: [
              { id: 'o1', text: 'Legacy', x: 0.5, y: 0.9, fontSize: 48, color: '#FFFFFF' },
            ],
            transform: { x: 0.1, y: -0.1, scale: 1.2, rotationDeg: 5 },
            crop: { left: 0.05, top: 0, right: 0.05, bottom: 0.1 },
            blendMode: 'screen',
            effects: [
              {
                type: 'chromakey',
                id: 'ck1',
                enabled: true,
                keyColor: '#00FF00',
                similarity: 0.2,
                blend: 0.1,
                despill: 0.5,
              },
              { type: 'lut', id: 'lut1', enabled: false, lutAssetId: 'lutAsset', intensity: 0.6 },
              {
                type: 'lumetri',
                id: 'grade1',
                enabled: true,
                exposure: 0.2,
                contrast: 1.1,
                saturation: 1,
                temperature: 5,
                tint: 0,
                vibrance: 0.1,
              },
            ],
            pan: -0.3,
            keyframes: {
              positionX: [
                { t: 0, value: 0, ease: 'linear' },
                { t: 4, value: 0.2, ease: 'easeBoth' },
              ],
              scale: [{ t: 0, value: 1, ease: 'hold' }],
              opacity: [{ t: 1, value: 0.5, ease: 'easeIn' }],
              effects: { 'grade1.exposure': [{ t: 0, value: 0, ease: 'linear' }] },
            },
            groupId: 'g1',
          },
          {
            ...v1.clips[1],
            transition: { type: 'pushLeft', durationSeconds: 0.5, params: { softness: 0.2 } },
            transitionInSeconds: 0.5,
            timelineStart: 11.5,
            speed: 1.5,
            maintainPitch: false,
            groupId: 'g1',
          },
        ],
      },
      {
        id: 'tv2',
        kind: 'video',
        index: 1,
        muted: false,
        locked: false,
        clips: [
          {
            id: 'title1',
            assetId: '',
            streamIndex: 0,
            timelineStart: 2,
            sourceIn: 0,
            sourceOut: 5,
            title: {
              layers: [
                {
                  type: 'rect',
                  x: 0.1,
                  y: 0.8,
                  w: 0.5,
                  h: 0.1,
                  color: '#000000',
                  opacity: 0.6,
                  radiusPx: 8,
                },
                {
                  type: 'text',
                  text: 'Sam Lee',
                  fontFamily: 'Montserrat',
                  fontSizePx: 64,
                  fontWeight: 700,
                  fillColor: '#FFFFFF',
                  strokeColor: '#000000',
                  strokeWidthPx: 2,
                  shadow: { xPx: 2, yPx: 2, blurPx: 4, color: '#000000' },
                  background: {
                    color: '#111111',
                    opacity: 0.5,
                    paddingXPx: 8,
                    paddingYPx: 4,
                    radiusPx: 4,
                  },
                  letterSpacingPx: 1,
                  lineHeight: 1.2,
                  align: 'left',
                  x: 0.12,
                  y: 0.82,
                },
                {
                  type: 'line',
                  x1: 0.1,
                  y1: 0.9,
                  x2: 0.6,
                  y2: 0.9,
                  color: '#FFCC00',
                  thicknessPx: 3,
                },
              ],
            },
          },
          {
            id: 'freeze1',
            assetId: 'city',
            streamIndex: 0,
            timelineStart: 9,
            sourceIn: 4,
            sourceOut: 6,
            freeze: { sourceTime: 4 },
          },
        ],
      },
      {
        ...a1,
        gain: 1.4,
        pan: 0.2,
        solo: true,
        effects: {
          eq: { lowGainDb: -3, midGainDb: 2, highGainDb: 1 },
          compressor: { thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 200, makeupDb: 2 },
        },
        clips: [
          {
            ...a1.clips[0],
            volumeKeyframes: [
              { t: 0, gain: 0.5 },
              { t: 3, gain: 1 },
            ],
            keyframes: {
              volume: [{ t: 0, value: 0.5, ease: 'linear' }],
              pan: [{ t: 0, value: 0, ease: 'linear' }],
            },
          },
        ],
      },
      { ...a2, muted: true, locked: true },
    ],
    captions: golden.cues,
    captionStyle: golden.style ?? undefined,
    captionsEnabled: false,
    captionsLanguage: 'en',
    audio: {
      duckingEnabled: true,
      duckVoiceTrackId: 'ta1',
      duckAmountDb: 12,
      duckAttackMs: 100,
      duckReleaseMs: 500,
      masterGain: 0.9,
    },
    markers: [
      { id: 'm1', t: 1, name: 'Intro', color: '#FF0000', comment: 'start here' },
      { id: 'm2', t: 10, name: 'Cut', color: '#00FF00' },
    ],
  };
}

const FIXTURES: [string, unknown][] = [
  ['studioFixture (web Medi ops fixture)', studioFixture()],
  [
    'devSynthetic (200 clips, 6 tracks)',
    buildSyntheticProject({ clipCount: 200, videoTracks: 4, audioTracks: 2, durationSeconds: 600 }),
  ],
  ['devSynthetic (web default: 1,000 clips / 12 tracks / 60 min)', buildSyntheticProject()],
  ['legacy MM121 caption project', LEGACY],
  ['kitchen sink (every v2/v3 field group)', kitchenSink()],
  ...goldenCaptions.map((g): [string, unknown] => [
    `caption golden ${g.name}: cues + style`,
    { ...studioFixture(), captions: g.cues, captionStyle: g.style ?? undefined },
  ]),
];

// --- helpers -------------------------------------------------------------------

/** JSON as it goes over the wire (undefined keys dropped). */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Every leaf path -> value of a JSON value. */
function leaves(v: unknown, path = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(v)) {
    if (v.length === 0) out.set(path, '[]');
    v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  } else if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) out.set(path, '{}');
    for (const k of keys) leaves((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
  } else out.set(path, v);
  return out;
}

/** The editable slice a save carries (server metadata excluded), as on the wire. */
const editable = (p: StudioProject) =>
  wire({
    name: p.name,
    fps: p.fps,
    width: p.width,
    height: p.height,
    tracks: p.tracks,
    captions: p.captions,
    captionStyle: p.captionStyle,
    captionsEnabled: p.captionsEnabled,
    audio: p.audio,
    markers: p.markers,
  });

function openStore(input: unknown): { store: StudioStore; parsed: StudioProject } {
  const parsed = studioProjectSchema.parse(wire(input));
  const store = makeStudioStore();
  store.dispatch(studioActions.loaded({ projectId: parsed.id, doc: parsed }));
  return { store, parsed };
}

function saveBody(store: StudioStore): StudioSaveProjectRequest {
  const s = store.getState();
  return wire(toSaveRequest(s.doc!, s.serverRevision));
}

// --- 1. load -> no-op -> save --------------------------------------------------

describe('round trip: web fixture -> store -> mutate(no-op) -> save payload', () => {
  it.each(FIXTURES)('%s', (_name, input) => {
    const { store, parsed } = openStore(input);
    const loadedDoc = store.getState().doc;
    mutate(store, 'no-op', (d) => d);
    expect(store.getState().doc).toBe(loadedDoc);
    expect(store.getState().dirty).toBe(false);

    const body = saveBody(store);
    // The web store's toSaveRequest of the same (normalized) document, field for field.
    const web = normalizeProject(parsed);
    expect(body).toEqual(
      wire({
        name: web.name,
        schemaVersion: 3,
        fps: web.fps,
        width: web.width,
        height: web.height,
        tracks: store.getState().doc!.tracks,
        captions: web.captions,
        captionStyle: web.captionStyle,
        captionsEnabled: web.captionsEnabled,
        audio: web.audio,
        markers: web.markers,
        expectedRevision: parsed.revision,
      }),
    );

    // Nothing the input carried is dropped or changed (normalisation only ADDS v3 fields).
    const sent = leaves(wire({ ...body, tracks: body.tracks }));
    for (const [path, value] of leaves(editable(parsed))) {
      // An empty `tracks` gains the web's base V1/A1 lanes on load (ensureBaseTracks).
      if (value === '[]' && [...sent.keys()].some((k) => k.startsWith(`${path}[`))) continue;
      expect([path, sent.get(path)]).toEqual([path, value]);
    }

    // The body is a valid save request and is stable through the API's request schema.
    const reparsed = studioSaveProjectRequestSchema.parse(body);
    expect(wire(reparsed)).toEqual(body);
  });

  it('covers the storable caption goldens (renderer-only ones are counted, not silently lost)', () => {
    expect(allGoldenCaptions.length).toBeGreaterThanOrEqual(30);
    expect(allGoldenCaptions.length - goldenCaptions.length).toBeLessThanOrEqual(4);
  });

  it('a second load of the saved body yields the same document (idempotent normalisation)', () => {
    const { store } = openStore(kitchenSink());
    const first = saveBody(store);
    const again = openStore({ ...wire(store.getState().doc!), ...first });
    expect(saveBody(again.store)).toEqual(first);
  });
});

// --- 2. each phase-1 edit changes only what it owns ---------------------------------

type ClipMap = Map<string, StudioClip>;
const clipsOf = (p: StudioProject): ClipMap =>
  new Map(p.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
const omit = (o: object, keys: readonly string[]) =>
  wire(Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))));
const trackShell = (p: StudioProject) => p.tracks.map((t) => omit(t, ['clips']));
const projectShell = (p: StudioProject) => omit(p, ['tracks', 'revision', 'updatedAt']);

/**
 * Asserts the edit kept everything outside `owned`: project-level fields, every track's own
 * fields, every clip other than `owned.clips`, and on those clips every key outside `owned.keys`.
 * `added` lists ids the edit may create (split's right half).
 */
function expectOnlyOwned(
  before: StudioProject,
  after: StudioProject,
  owned: { clips: string[]; keys: string[]; added?: number },
) {
  expect(after).not.toBe(before);
  expect(projectShell(after)).toEqual(projectShell(before));
  expect(trackShell(after)).toEqual(trackShell(before));
  const b = clipsOf(before);
  const a = clipsOf(after);
  expect(a.size).toBe(b.size + (owned.added ?? 0));
  for (const [id, clip] of b) {
    const next = a.get(id);
    expect(next).toBeDefined();
    if (owned.clips.includes(id)) expect(omit(next!, owned.keys)).toEqual(omit(clip, owned.keys));
    else expect(wire(next)).toEqual(wire(clip));
  }
  // Untouched tracks keep their reference (structural sharing, cheap snapshots).
  after.tracks.forEach((t, i) => {
    const touched = t.clips.some((c) => owned.clips.includes(c.id) || !b.has(c.id));
    if (!touched) expect(t).toBe(before.tracks[i]);
  });
}

describe('round trip: phase-1 edits own only their fields', () => {
  const ASSETS = {
    beach: { mediaKind: 'video' as const, durationSeconds: 20 },
    city: { mediaKind: 'video' as const, durationSeconds: 30 },
  };

  function run(label: string, fn: (d: StudioProject) => StudioProject) {
    const { store } = openStore(kitchenSink());
    const before = store.getState().doc!;
    mutate(store, label, fn);
    const after = store.getState().doc!;
    // The save payload is still a valid request that carries every untouched field.
    expect(studioSaveProjectRequestSchema.safeParse(saveBody(store)).success).toBe(true);
    return { before, after };
  }

  it('trim (right edge of a keyframed, effected clip)', () => {
    const { before, after } = run('Trim', (d) => trimClip(d, 'clipA', 'r', -2, ASSETS.beach));
    expect(clipsOf(after).get('clipA')!.sourceOut).toBe(10);
    expectOnlyOwned(before, after, {
      clips: ['clipA'],
      keys: ['sourceIn', 'sourceOut', 'timelineStart'],
    });
  });

  it('split (left keeps the id; the right half copies every field but its own)', () => {
    const { before, after } = run('Split', (d) => splitAt(d, 6, ['voice1']));
    expectOnlyOwned(before, after, { clips: ['voice1'], keys: ['sourceOut'], added: 1 });
    const orig = clipsOf(before).get('voice1')!;
    const right = after.tracks.find((t) => t.id === 'ta1')!.clips.find((c) => c.id !== 'voice1')!;
    expect(
      omit(right, [
        'id',
        'timelineStart',
        'sourceIn',
        'transition',
        'transitionInSeconds',
        'groupId',
      ]),
    ).toEqual(
      omit(orig, [
        'id',
        'timelineStart',
        'sourceIn',
        'transition',
        'transitionInSeconds',
        'groupId',
      ]),
    );
    expect(right).toMatchObject({ timelineStart: 6, sourceIn: 6 });
  });

  it('move (within the gap before the next clip on its track)', () => {
    const { before, after } = run('Move', (d) => moveClip(d, 'title1', 3));
    expect(clipsOf(after).get('title1')!.timelineStart).toBe(3);
    expectOnlyOwned(before, after, {
      clips: ['title1'],
      keys: ['timelineStart', 'transition', 'transitionInSeconds'],
    });
  });

  it('speed', () => {
    const { before, after } = run('Speed', (d) => setClipSpeed(d, 'clipA', 2, 'video'));
    expect(clipsOf(after).get('clipA')!.speed).toBe(2);
    expectOnlyOwned(before, after, { clips: ['clipA'], keys: ['speed'] });
  });

  it('volume (keyframes and volumeKeyframes survive untouched)', () => {
    const { before, after } = run('Volume', (d) => setClipVolume(d, 'voice1', 1.6));
    expect(clipsOf(after).get('voice1')!.volume).toBe(1.6);
    expectOnlyOwned(before, after, { clips: ['voice1'], keys: ['volume'] });
  });

  it('look (the clip grade, LUT and chroma key effects survive)', () => {
    const { before, after } = run('Look', (d) => applyLook(d, 'clipA', 'cinematic', 0.7));
    expectOnlyOwned(before, after, { clips: ['clipA'], keys: ['effects'] });
    const fx = clipsOf(after).get('clipA')!.effects!;
    expect(fx[0]!.id).toBe('look-cinematic');
    expect(wire(fx.slice(1))).toEqual(wire(clipsOf(before).get('clipA')!.effects));
  });

  it('transition (typed, from the previous clip)', () => {
    const { before, after } = run('Transition', (d) =>
      setClipTransition(d, 'clipB', { type: 'crossDissolve', durationSeconds: 1 }),
    );
    expect(clipsOf(after).get('clipB')!.transition).toEqual({
      type: 'crossDissolve',
      durationSeconds: 1,
    });
    expectOnlyOwned(before, after, {
      clips: ['clipB'],
      keys: ['transition', 'transitionInSeconds', 'timelineStart'],
    });
  });

  it('title text (only the text of the text layer)', () => {
    const { before, after } = run('Title', (d) => setTitleText(d, 'title1', 'Alina'));
    expectOnlyOwned(before, after, { clips: ['title1'], keys: ['title'] });
    const b = clipsOf(before).get('title1')!.title!.layers;
    const a = clipsOf(after).get('title1')!.title!.layers;
    expect(a.map((l) => omit(l, ['text']))).toEqual(b.map((l) => omit(l, ['text'])));
    expect(a[1]).toMatchObject({ type: 'text', text: 'Alina' });
  });

  it('an edit on a locked track is refused whole (the A2 music track)', () => {
    const { store } = openStore(kitchenSink());
    const before = store.getState().doc;
    mutate(store, 'Volume', (d) => setClipVolume(d, 'music1', 0.1));
    expect(store.getState().doc).toBe(before);
  });
});
