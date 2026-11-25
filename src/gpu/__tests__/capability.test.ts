/**
 * MA60 decision 4: the GPU capability check. Forced failures (device creation that throws or
 * rejects, an adapter that rejects or is null, no `navigator.gpu`, a hung probe) all end
 * `unavailable` with their bucket, never a throw; one probe per launch; the MMKV cache is keyed by
 * the app version; `gpu_capability_checked` fires once per probe and never on a cache hit.
 */
import {
  checkGpuCapability,
  defaultDeps,
  GPU_CAPABILITY_KEY,
  gpuEditors,
  probeGpu,
  resetGpuCapabilityForTests,
  type CapabilityDeps,
  type GpuLike,
} from '../capability';

jest.mock('@/analytics/track', () => ({
  EVENTS: { GPU_CAPABILITY_CHECKED: 'gpu_capability_checked' },
  track: jest.fn(),
}));

function memoryKv() {
  const m = new Map<string, string>();
  return {
    m,
    kv: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    },
  };
}

const okGpu = (destroy = jest.fn()): GpuLike => ({
  requestAdapter: async () => ({ requestDevice: async () => ({ destroy }) }),
});

function deps(gpu: () => GpuLike | undefined, over: Partial<CapabilityDeps> = {}) {
  const { kv, m } = memoryKv();
  const track = jest.fn();
  const d: CapabilityDeps = { gpu, kv, appVersion: () => '1.0.0+12', track, ...over };
  return { d, m, track };
}

beforeEach(() => resetGpuCapabilityForTests());

describe('probeGpu (forced failures)', () => {
  it('ok when a device is created (and the probe device is destroyed again)', async () => {
    const destroy = jest.fn();
    await expect(probeGpu(() => okGpu(destroy))).resolves.toEqual({
      gpuEditors: 'ok',
      reason: 'none',
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('device creation that THROWS synchronously is unavailable / device_failed', async () => {
    const gpu: GpuLike = {
      requestAdapter: async () => ({
        requestDevice: () => {
          throw new Error('Cannot convert JS Value to Enum');
        },
      }),
    };
    await expect(probeGpu(() => gpu)).resolves.toEqual({
      gpuEditors: 'unavailable',
      reason: 'device_failed',
    });
  });

  it('device creation that REJECTS is unavailable / device_failed', async () => {
    const gpu: GpuLike = {
      requestAdapter: async () => ({
        requestDevice: () => Promise.reject(new Error('Required limit is greater than supported')),
      }),
    };
    await expect(probeGpu(() => gpu)).resolves.toEqual({
      gpuEditors: 'unavailable',
      reason: 'device_failed',
    });
  });

  it('a rejected or throwing adapter request is adapter_failed; a null adapter no_adapter', async () => {
    await expect(
      probeGpu(() => ({ requestAdapter: () => Promise.reject(new Error('x')) })),
    ).resolves.toEqual({ gpuEditors: 'unavailable', reason: 'adapter_failed' });
    await expect(
      probeGpu(() => ({
        requestAdapter: () => {
          throw new Error('x');
        },
      })),
    ).resolves.toEqual({ gpuEditors: 'unavailable', reason: 'adapter_failed' });
    await expect(probeGpu(() => ({ requestAdapter: async () => null }))).resolves.toEqual({
      gpuEditors: 'unavailable',
      reason: 'no_adapter',
    });
  });

  it('no navigator.gpu (undefined, or the native module throwing at import) is no_gpu_api', async () => {
    await expect(probeGpu(() => undefined)).resolves.toEqual({
      gpuEditors: 'unavailable',
      reason: 'no_gpu_api',
    });
    await expect(
      probeGpu(() => {
        throw new Error('[react-native-webgpu] the native module failed to install');
      }),
    ).resolves.toEqual({ gpuEditors: 'unavailable', reason: 'no_gpu_api' });
  });

  it('a probe that never answers times out', async () => {
    jest.useFakeTimers();
    try {
      const hung: GpuLike = { requestAdapter: () => new Promise(() => undefined) };
      const p = probeGpu(() => hung, 1000);
      await jest.advanceTimersByTimeAsync(1001);
      await expect(p).resolves.toEqual({ gpuEditors: 'unavailable', reason: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('checkGpuCapability', () => {
  it('probes once per launch, caches with the app version, tracks once', async () => {
    const requestAdapter = jest.fn(okGpu().requestAdapter);
    const { d, m, track } = deps(() => ({ requestAdapter }));
    const [a, b] = await Promise.all([checkGpuCapability(d), checkGpuCapability(d)]);
    expect(a).toEqual({ gpuEditors: 'ok', reason: 'none', from: 'probe' });
    expect(b).toBe(a);
    await checkGpuCapability(d);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(gpuEditors()).toBe('ok');
    expect(JSON.parse(m.get(GPU_CAPABILITY_KEY)!)).toEqual({
      v: '1.0.0+12',
      gpuEditors: 'ok',
      reason: 'none',
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('ok', 'none');
  });

  it('forced failure: a device creation that throws ends unavailable, cached and tracked, no throw', async () => {
    const { d, m, track } = deps(() => ({
      requestAdapter: async () => ({
        requestDevice: () => {
          throw new Error('device refused');
        },
      }),
    }));
    await expect(checkGpuCapability(d)).resolves.toEqual({
      gpuEditors: 'unavailable',
      reason: 'device_failed',
      from: 'probe',
    });
    expect(gpuEditors()).toBe('unavailable');
    expect(JSON.parse(m.get(GPU_CAPABILITY_KEY)!).gpuEditors).toBe('unavailable');
    expect(track).toHaveBeenCalledWith('unavailable', 'device_failed');
  });

  it('a later launch of the same version reads the cache: no probe, no event', async () => {
    const first = deps(() => okGpu());
    await checkGpuCapability(first.d);
    resetGpuCapabilityForTests(); // a new launch
    const gpu = jest.fn(() => okGpu());
    const track = jest.fn();
    const r = await checkGpuCapability({ ...first.d, gpu, track });
    expect(r).toEqual({ gpuEditors: 'ok', reason: 'none', from: 'cache' });
    expect(gpu).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('a new app version (store build) probes again; a corrupt cache entry is ignored', async () => {
    const { d, m } = deps(() => okGpu());
    m.set(
      GPU_CAPABILITY_KEY,
      JSON.stringify({ v: '1.0.0+11', gpuEditors: 'unavailable', reason: 'device_failed' }),
    );
    await expect(checkGpuCapability(d)).resolves.toMatchObject({ gpuEditors: 'ok', from: 'probe' });
    resetGpuCapabilityForTests();
    m.set(GPU_CAPABILITY_KEY, '{not json');
    await expect(checkGpuCapability(d)).resolves.toMatchObject({ from: 'probe' });
    resetGpuCapabilityForTests();
    m.set(
      GPU_CAPABILITY_KEY,
      JSON.stringify({ v: '1.0.0+12', gpuEditors: 'maybe', reason: 'none' }),
    );
    await expect(checkGpuCapability(d)).resolves.toMatchObject({ from: 'probe' });
  });

  it('storage and analytics failures never break the check', async () => {
    const { d } = deps(() => okGpu(), {
      kv: {
        getItem: () => Promise.reject(new Error('mmkv')),
        setItem: () => Promise.reject(new Error('mmkv')),
      },
      track: () => {
        throw new Error('analytics');
      },
    });
    await expect(checkGpuCapability(d)).resolves.toEqual({
      gpuEditors: 'ok',
      reason: 'none',
      from: 'probe',
    });
  });
});

describe('defaultDeps under jest', () => {
  // Under jest the real package throws at import (no WebGPUModule TurboModule), exactly as on a
  // device whose native module failed to install: the lazy require turns it into no_gpu_api.
  it('the real wiring: react-native-webgpu throwing at import is unavailable / no_gpu_api, never a throw', async () => {
    const real = defaultDeps();
    const { kv } = memoryKv();
    const track = jest.fn();
    const r = await checkGpuCapability({ ...real, kv, track, appVersion: () => 't' });
    expect(r).toMatchObject({ gpuEditors: 'unavailable', reason: 'no_gpu_api' });
    expect(track).toHaveBeenCalledWith('unavailable', 'no_gpu_api');
  });
});
