/**
 * GPU capability for the GPU editors (ticket MA60 decision 4; Darkroom MA62, Motion MA66). Tries to
 * create a WebGPU device (react-native-webgpu, on the Dawn copy Skia 3 shares) at most once per
 * launch, and caches the answer in MMKV with the app version (`<semver>+<build>`), so a launch of
 * the same build reads the cache and a new store build probes again. The result is
 * `gpuEditors: 'ok' | 'unavailable'`; nothing here is shown to the user.
 *
 * Aperture does NOT use this: Skia's own rendering does not need a WebGPU device (MA59).
 *
 * Analytics: `gpu_capability_checked {result, reason_bucket}` once per probe (never on a cache hit),
 * a bucket only, never the driver's message.
 *
 * Every dependency is injected (`CapabilityDeps`), so the forced-failure paths are tested without a
 * GPU; `defaultDeps()` wires the app's.
 */
import { EVENTS, track } from '@/analytics/track';
import { mmkvStorage } from '@/state/persist';
import { appVersionString } from '@/lib/userAgent';

export type GpuEditors = 'ok' | 'unavailable';

/** Why the probe failed (the catalog's `reason_bucket`); `none` when it succeeded. */
export type GpuReasonBucket =
  'none' | 'no_gpu_api' | 'no_adapter' | 'adapter_failed' | 'device_failed' | 'timeout' | 'error';

export interface GpuCapability {
  gpuEditors: GpuEditors;
  reason: GpuReasonBucket;
  /** `cache`: read from MMKV for this app version; `probe`: a device was tried this launch. */
  from: 'cache' | 'probe';
}

/** The slice of WebGPU the probe uses (the real `GPU`, or a fake in tests). */
export interface GpuLike {
  requestAdapter(): Promise<{
    requestDevice(): Promise<{ destroy?: () => void }>;
  } | null>;
}

export interface CapabilityKv {
  getItem(key: string): Promise<string | null | undefined>;
  setItem(key: string, value: string): Promise<unknown>;
}

export interface CapabilityDeps {
  /** `navigator.gpu` once react-native-webgpu is installed; undefined (or a throw) when there is none. */
  gpu: () => GpuLike | undefined;
  kv: CapabilityKv;
  appVersion: () => string;
  track: (result: GpuEditors, reason: GpuReasonBucket) => void;
  timeoutMs?: number;
}

export const GPU_CAPABILITY_KEY = 'gpuCapability';
export const GPU_PROBE_TIMEOUT_MS = 5000;

interface Cached {
  v: string;
  gpuEditors: GpuEditors;
  reason: GpuReasonBucket;
}

const REASONS: readonly GpuReasonBucket[] = [
  'none',
  'no_gpu_api',
  'no_adapter',
  'adapter_failed',
  'device_failed',
  'timeout',
  'error',
];

function parseCached(raw: string | null | undefined, version: string): Cached | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<Cached>;
    if (c.v !== version) return null;
    if (c.gpuEditors !== 'ok' && c.gpuEditors !== 'unavailable') return null;
    if (!REASONS.includes(c.reason as GpuReasonBucket)) return null;
    return c as Cached;
  } catch {
    return null;
  }
}

class Timeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Timeout()), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/**
 * One device creation: adapter, then device, then the device is destroyed again (the editors make
 * their own). A throw, a rejection, a null adapter or no answer in `timeoutMs` is `unavailable`.
 */
export async function probeGpu(
  getGpu: () => GpuLike | undefined,
  timeoutMs = GPU_PROBE_TIMEOUT_MS,
): Promise<{ gpuEditors: GpuEditors; reason: GpuReasonBucket }> {
  const fail = (reason: GpuReasonBucket) => ({ gpuEditors: 'unavailable' as const, reason });
  let gpu: GpuLike | undefined;
  try {
    gpu = getGpu();
  } catch {
    return fail('no_gpu_api');
  }
  if (!gpu || typeof gpu.requestAdapter !== 'function') return fail('no_gpu_api');
  let adapter: Awaited<ReturnType<GpuLike['requestAdapter']>>;
  try {
    adapter = await withTimeout(
      Promise.resolve().then(() => gpu.requestAdapter()),
      timeoutMs,
    );
  } catch (e) {
    return fail(e instanceof Timeout ? 'timeout' : 'adapter_failed');
  }
  if (!adapter) return fail('no_adapter');
  try {
    const device = await withTimeout(
      Promise.resolve().then(() => adapter.requestDevice()),
      timeoutMs,
    );
    if (!device) return fail('device_failed');
    try {
      device.destroy?.();
    } catch {
      // the probe's device is released either way
    }
    return { gpuEditors: 'ok', reason: 'none' };
  } catch (e) {
    return fail(e instanceof Timeout ? 'timeout' : 'device_failed');
  }
}

let current: GpuCapability | null = null;
let inFlight: Promise<GpuCapability> | null = null;

/**
 * The capability for this launch: the cached answer for this app version, else one probe (cached
 * and tracked). Concurrent and later calls in the same launch share the first call's result.
 */
export function checkGpuCapability(deps: CapabilityDeps = defaultDeps()): Promise<GpuCapability> {
  if (current) return Promise.resolve(current);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const version = deps.appVersion();
    let raw: string | null | undefined = null;
    try {
      raw = await deps.kv.getItem(GPU_CAPABILITY_KEY);
    } catch {
      raw = null;
    }
    const hit = parseCached(raw, version);
    if (hit) {
      current = { gpuEditors: hit.gpuEditors, reason: hit.reason, from: 'cache' };
      return current;
    }
    let r: { gpuEditors: GpuEditors; reason: GpuReasonBucket };
    try {
      r = await probeGpu(deps.gpu, deps.timeoutMs);
    } catch {
      r = { gpuEditors: 'unavailable', reason: 'error' };
    }
    current = { ...r, from: 'probe' };
    try {
      await deps.kv.setItem(
        GPU_CAPABILITY_KEY,
        JSON.stringify({ v: version, gpuEditors: r.gpuEditors, reason: r.reason } satisfies Cached),
      );
    } catch {
      // not cached: the next launch probes again
    }
    try {
      deps.track(r.gpuEditors, r.reason);
    } catch {
      // analytics never breaks the check
    }
    return current;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The answer once `checkGpuCapability` has settled this launch; null before. */
export function gpuEditors(): GpuEditors | null {
  return current?.gpuEditors ?? null;
}

/** Tests only: forget this launch's answer. */
export function resetGpuCapabilityForTests(): void {
  current = null;
  inFlight = null;
}

/**
 * The app's wiring. react-native-webgpu installs `navigator.gpu` when it is first imported and
 * throws at import time when its native module failed to install, so it is required lazily inside
 * the probe (a throw there is `no_gpu_api`, never a crash at app start).
 */
export function defaultDeps(): CapabilityDeps {
  return {
    gpu: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('react-native-webgpu');
      const nav = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator;
      return nav?.gpu;
    },
    kv: mmkvStorage,
    appVersion: appVersionString,
    track: (result, reason) =>
      track(EVENTS.GPU_CAPABILITY_CHECKED, { result, reason_bucket: reason }),
  };
}
