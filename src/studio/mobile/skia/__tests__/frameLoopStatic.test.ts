/**
 * Static checks of the UI-runtime frame loop (MA62 S4, decision 0), the things jest cannot see by
 * running it:
 * - the `useFrameCallback` body in `StudioPreview.tsx` and `previewFrame()` allocate nothing per
 *   frame outside their one-time setup (no object / array literal, closure, spread, `new`,
 *   allocating array method or template string) and log nothing;
 * - every module the loop calls into is a worklet module (the Worklets Babel plugin turns its
 *   top-level functions into worklets): the copied resolver files carry the sync script's file
 *   directive, the phone's compositor / packers / pump / sink are worklets, and their transform
 *   succeeds with the app's own Babel config (a TypeScript parameter property or a class extending
 *   `Error` would fail here, not on the phone);
 * - the JS side reads the loop's outputs only from timers (no `requestAnimationFrame`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformFileSync } from '@babel/core';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (code: string) => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the function starting at `marker` (balanced braces from its first `{`). */
function bodyOf(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  let i = src.indexOf('{', src.indexOf(')', start));
  const from = i;
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(from, i + 1);
}

function expectNoAllocation(code: string) {
  const c = strip(code);
  expect(c).not.toMatch(/[=(,:]\s*\{(?!\s*$)/m); // object literal
  expect(c).not.toMatch(/[=(,:]\s*\[/); // array literal
  expect(c).not.toMatch(/=>|function\s*\(/); // closure
  expect(c).not.toMatch(/\.\.\./);
  expect(c).not.toMatch(/\bnew\s/);
  expect(c).not.toMatch(/\.(slice|map|filter|concat|reduce|forEach|splice)\(/);
  expect(c).not.toMatch(/`/);
  expect(c).not.toMatch(/console\./);
}

describe('the UI-runtime frame body allocates nothing and logs nothing', () => {
  it('StudioPreview useFrameCallback: everything after the one-time setup', () => {
    const src = read('src/studio/mobile/skia/StudioPreview.tsx');
    const body = bodyOf(src, 'useFrameCallback((fi) => {');
    // The one-time setup (device, sink, compositor) runs once per mount, guarded by `if (!u)`.
    const setupEnd = body.indexOf('ui.value = u;');
    expect(setupEnd).toBeGreaterThan(0);
    const perFrame = body.slice(body.indexOf('}', setupEnd) + 1);
    expectNoAllocation(perFrame);
    expect(strip(body)).not.toMatch(/console\./);
  });

  it('previewFrame(): the per-frame function', () => {
    const src = read('src/studio/mobile/skia/previewFrame.ts');
    const body = bodyOf(src, 'export function previewFrame(');
    // `planFrame` (called only when the time crossed a project frame or the scene changed) is the
    // one allocating step, by design (the copied resolver returns fresh layers, as on the web).
    expectNoAllocation(body.replace(/st\.layers = planFrame\([^;]*;/, ''));
  });

  it('no per-frame logging in any module the loop runs', () => {
    for (const f of [
      'src/studio/mobile/skia/previewFrame.ts',
      'src/studio/mobile/skia/compositor/compositor.ts',
      'src/studio/mobile/skia/compositor/uniforms.ts',
      'src/studio/mobile/player/framePump.ts',
      'src/studio/mobile/player/gpuFrameSink.ts',
      'src/studio/mobile/skia/text/captionTimeline.ts',
    ]) {
      expect([f, /console\./.test(strip(read(f)))]).toEqual([f, false]);
    }
  });

  it('no JS-thread per-frame loop (MA76 rule 1)', () => {
    for (const f of ['src/studio/mobile/skia/StudioPreview.tsx', 'src/studio/mobile/skia/previewController.ts']) {
      expect([f, /requestAnimationFrame/.test(strip(read(f)))]).toEqual([f, false]);
    }
  });
});

describe('every module the loop calls into is a worklet module', () => {
  const babel = (f: string) =>
    transformFileSync(join(ROOT, f), {
      cwd: ROOT,
      babelrc: false,
      configFile: join(ROOT, 'babel.config.js'),
      caller: { name: 'metro', platform: 'android', bundler: 'metro', isDev: false } as never,
    })!.code!;

  it.each([
    'src/studio/previewEngine.ts',
    'src/studio/speed.ts',
    'src/studio/ease.ts',
    'src/studio/compositor/buildLayers.ts',
    'src/studio/mobile/skia/compositor/compositor.ts',
    'src/studio/mobile/skia/previewFrame.ts',
  ])('%s has a file-level worklet directive and transforms', (f) => {
    expect(read(f)).toMatch(/^(\/\/[^\n]*\n)*'worklet';/);
    expect(babel(f)).toContain('__workletHash');
  });

  it.each([
    'src/studio/mobile/skia/compositor/uniforms.ts',
    'src/studio/mobile/player/framePump.ts',
    'src/studio/mobile/player/gpuFrameSink.ts',
    'src/studio/mobile/player/speedPolicy.ts',
  ])('%s: every exported function the loop calls is a worklet', (f) => {
    expect(babel(f)).toContain('__workletHash');
  });

  it('the compositor classes are worklet classes (no parameter properties, no Error subclass)', () => {
    const code = babel('src/studio/mobile/skia/compositor/compositor.ts');
    expect(code).toContain('Compositor__classFactory');
    expect(code).toContain('LayerChain__classFactory');
  });
});
