/**
 * Heal and subject-mask flows over a fake fetch (acceptance 4): the mask is posted at the
 * current BASE size (the API refuses any other size), `heals[]` gets `{id, maskRef, baseRef}` on
 * job completion, 429 surfaces as the quota error, and the 50 MP memory cap refuses the press.
 */
import { parsePhotoDoc, newPhotoDoc, type PhotoDoc } from '../../photoTypes';
import { healOutcomeOf, requestSubjectMask, type AiDeps } from '../../aiApi';
import { HEAL_MAX_MASK_MP, healMaskSize, healRefusal, runHeal, strokesInMaskSpace } from '../heal';

type Call = {
  url: string;
  method?: string;
  body?: unknown;
  fileUri?: string;
  parameters?: Record<string, string>;
};

function fakeDeps(script: {
  heal?: { status: number; body: unknown };
  jobs?: unknown[];
  subject?: { status: number; body: unknown };
}) {
  const calls: Call[] = [];
  const jobs = [...(script.jobs ?? [])];
  const deps: AiDeps = {
    baseUrl: 'https://api.test/api',
    headers: async () => ({ Authorization: 'Bearer t' }),
    fetch: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      if (url.includes('/masks/subject')) {
        const r = script.subject ?? { status: 200, body: {} };
        return { status: r.status, headers: {}, text: async () => JSON.stringify(r.body) };
      }
      const next = jobs.shift() ?? { status: 'processing', progress: 50 };
      return { status: 200, headers: {}, text: async () => JSON.stringify(next) };
    },
    upload: async (url, fileUri, o) => {
      calls.push({ url, fileUri, parameters: o.parameters });
      const r = script.heal ?? { status: 202, body: {} };
      return { status: r.status, headers: {}, body: JSON.stringify(r.body) };
    },
    download: async (_u, dest) => dest,
    sleep: async () => undefined,
  };
  return { deps, calls };
}

function doc(over: Partial<PhotoDoc> = {}): PhotoDoc {
  const r = parsePhotoDoc({ ...newPhotoDoc(4000, 3000), ...over });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

const completed = {
  id: 'j1',
  status: 'completed',
  healResult: {
    baseHash: 'abc123',
    baseRef: 'bases/abc123.png',
    proxyRef: 'bases/abc123.proxy.jpg',
    maskRef: 'masks/heal-0123456789abcdef.png',
    width: 4000,
    height: 3000,
  },
};

describe('heal flow', () => {
  it('posts the mask at base size, polls the job and appends {id, maskRef, baseRef}', async () => {
    const { deps, calls } = fakeDeps({
      heal: { status: 202, body: { jobId: 'j1', baseHash: 'abc123', maskRef: 'masks/heal-x.png' } },
      jobs: [{ id: 'j1', status: 'processing', progress: 40 }, completed],
    });
    const rendered: { size: { width: number; height: number }; n: number }[] = [];
    const progress: number[] = [];
    const d = doc();
    const r = await runHeal(
      {
        ai: deps,
        renderMask: async (strokes, size) => {
          rendered.push({ size, n: strokes.length });
          return 'file:///cache/heal-mask.png';
        },
      },
      {
        projectId: 'p1',
        doc: d,
        strokes: [
          { pts: [{ x: 0.5, y: 0.5 }], size: 40 },
          {
            pts: [
              { x: 0.1, y: 0.1 },
              { x: 0.2, y: 0.2 },
            ],
            size: 40,
          },
        ],
        out: { width: 4000, height: 3000 },
        mask: healMaskSize(d, {}),
        onProgress: (p) => progress.push(p),
      },
    );
    if (!r.ok) throw new Error(r.error.code);
    expect(rendered).toEqual([{ size: { width: 4000, height: 3000 }, n: 2 }]);
    expect(calls[0]).toMatchObject({
      url: 'https://api.test/api/photo/projects/p1/heal',
      fileUri: 'file:///cache/heal-mask.png',
      parameters: { base: '' },
    });
    expect(calls[1]!.url).toBe('https://api.test/api/job/j1');
    expect(progress).toEqual([40]);
    const next = r.doc(d);
    expect(next.heals).toEqual([
      { id: 'heal-1', baseRef: 'bases/abc123.png', maskRef: 'masks/heal-0123456789abcdef.png' },
    ]);
    expect(parsePhotoDoc(JSON.parse(JSON.stringify(next))).ok).toBe(true);
  });

  it('a second heal sends the current base hash and uses its size', async () => {
    const d = doc({
      heals: [{ id: 'heal-1', baseRef: 'bases/abc123.png', maskRef: 'masks/m.png' }],
    });
    expect(healMaskSize(d, { 'bases/abc123.png': { width: 3990, height: 2990 } })).toEqual({
      width: 3990,
      height: 2990,
    });
    const { deps, calls } = fakeDeps({
      heal: { status: 202, body: { jobId: 'j2' } },
      jobs: [completed],
    });
    const r = await runHeal(
      { ai: deps, renderMask: async () => 'file:///m.png' },
      {
        projectId: 'p1',
        doc: d,
        strokes: [{ pts: [{ x: 0.5, y: 0.5 }], size: 10 }],
        out: { width: 4000, height: 3000 },
        mask: { width: 4000, height: 3000 },
      },
    );
    expect(r.ok).toBe(true);
    expect(calls[0]!.parameters).toEqual({ base: 'abc123' });
  });

  it('429 surfaces as the quota error (the MA16 sheet) and nothing is appended', async () => {
    const { deps } = fakeDeps({
      heal: { status: 429, body: { error: 'quota_exceeded', metric: 'ai_ops', limit: 3 } },
    });
    const r = await runHeal(
      { ai: deps, renderMask: async () => 'file:///m.png' },
      {
        projectId: 'p1',
        doc: doc(),
        strokes: [{ pts: [{ x: 0.5, y: 0.5 }], size: 10 }],
        out: { width: 4000, height: 3000 },
        mask: { width: 4000, height: 3000 },
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.status).toBe(429);
  });

  it('a failed job reports and changes nothing', async () => {
    const { deps } = fakeDeps({
      heal: { status: 202, body: { jobId: 'j3' } },
      jobs: [{ id: 'j3', status: 'failed', error: 'Heal failed: boom' }],
    });
    const r = await runHeal(
      { ai: deps, renderMask: async () => 'file:///m.png' },
      {
        projectId: 'p1',
        doc: doc(),
        strokes: [{ pts: [{ x: 0.5, y: 0.5 }], size: 10 }],
        out: { width: 4000, height: 3000 },
        mask: { width: 4000, height: 3000 },
      },
    );
    expect(r.ok).toBe(false);
  });

  it('refuses without strokes, without a project, when unavailable, and over 50 MP', () => {
    const d = doc();
    const size = { width: 4000, height: 3000 };
    expect(healRefusal(d, 'p1', 2, size, true)).toBeNull();
    expect(healRefusal(d, 'p1', 0, size, true)).toBe('no_strokes');
    expect(healRefusal(d, null, 2, size, true)).toBe('no_project');
    expect(healRefusal(d, 'p1', 2, size, false)).toBe('unavailable');
    const big = { width: 8200, height: 6200 };
    expect((big.width * big.height) / 1e6).toBeGreaterThan(HEAL_MAX_MASK_MP);
    expect(healRefusal(d, 'p1', 2, big, true)).toBe('too_large');
  });

  it('maps display strokes through the inverse geometry into base pixels', () => {
    const g = {
      rotate: 0,
      flipH: true,
      flipV: false,
      perspective: null,
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      fill: 'transparent' as const,
    };
    const [s] = strokesInMaskSpace(
      [{ pts: [{ x: 0.5, y: 0.5 }], size: 20 }],
      g,
      { width: 4000, height: 3000 },
      { width: 2000, height: 3000 },
      { width: 2000, height: 1500 },
    );
    // Output centre (crop's centre = canvas x 3000) flipped -> source x 1000, scaled 0.5 -> 500.
    expect(s!.pts[0]!.x).toBeCloseTo(500, 0);
    expect(s!.pts[0]!.y).toBeCloseTo(750, 0);
    expect(s!.diameter).toBeCloseTo(10, 5);
  });

  it('healOutcomeOf reads the API healResult and refuses junk', () => {
    expect(healOutcomeOf(completed)?.baseRef).toBe('bases/abc123.png');
    expect(healOutcomeOf({ status: 'completed' })).toBeNull();
    expect(healOutcomeOf({ healResult: { baseHash: '../x', baseRef: '../x' } })).toBeNull();
  });
});

describe('subject mask', () => {
  it('posts {} for the original or {base} for a healed base, and validates maskRef', async () => {
    const ok = {
      maskId: 'subj-1',
      maskRef: 'masks/subj-0123456789abcdef.png',
      url: '/x',
      width: 4000,
      height: 3000,
    };
    const a = fakeDeps({ subject: { status: 200, body: ok } });
    const r = await requestSubjectMask(a.deps, 'p1');
    expect(r).toEqual({
      ok: true,
      value: { maskId: 'subj-1', maskRef: ok.maskRef, width: 4000, height: 3000 },
    });
    expect(a.calls[0]).toMatchObject({
      url: 'https://api.test/api/photo/projects/p1/masks/subject',
      method: 'POST',
      body: {},
    });
    const b = fakeDeps({ subject: { status: 200, body: ok } });
    await requestSubjectMask(b.deps, 'p1', 'abc123');
    expect(b.calls[0]!.body).toEqual({ base: 'abc123' });
    const c = fakeDeps({ subject: { status: 200, body: { ...ok, maskRef: '../../etc/passwd' } } });
    expect((await requestSubjectMask(c.deps, 'p1')).ok).toBe(false);
    const q = fakeDeps({
      subject: { status: 429, body: { error: 'quota_exceeded', metric: 'ops' } },
    });
    const qr = await requestSubjectMask(q.deps, 'p1');
    expect(qr.ok === false && qr.error.status).toBe(429);
  });
});
