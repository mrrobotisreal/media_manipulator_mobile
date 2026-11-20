/**
 * Runs the web's copied Darkroom vitest suites under jest (ticket MA61 S1). jest maps the `vitest`
 * import here (`jest.config.js` moduleNameMapper); test code only, never imported by the app.
 *
 * - `expect(value, message)`: vitest's optional message argument is dropped (jest takes one).
 * - `vi.mock(...)` is a no-op: vitest hoists it, jest would not, and the one copied suite that uses
 *   it only stubs the backend seam, which on the phone is already a pure URL module.
 * - `vi.*` timers and `vi.fn` forward to the jest object.
 */

const jestExpect = (globalThis as any).expect as jest.Expect;

const shimExpect: any = (value: unknown) => jestExpect(value);
Object.assign(shimExpect, jestExpect);

export const expect = shimExpect as typeof jestExpect;
export const describe = (globalThis as any).describe as typeof globalThis.describe;
export const it = (globalThis as any).it as typeof globalThis.it;
export const test = (globalThis as any).test as typeof globalThis.test;
export const beforeEach = (globalThis as any).beforeEach as typeof globalThis.beforeEach;
export const afterEach = (globalThis as any).afterEach as typeof globalThis.afterEach;
export const beforeAll = (globalThis as any).beforeAll as typeof globalThis.beforeAll;
export const afterAll = (globalThis as any).afterAll as typeof globalThis.afterAll;

export const vi = {
  fn: (impl?: (...args: any[]) => any) => jest.fn(impl),
  mock: (_path: string, _factory?: () => unknown) => undefined,
  spyOn: (obj: any, key: any) => jest.spyOn(obj, key),
  restoreAllMocks: () => jest.restoreAllMocks(),
  useFakeTimers: () => jest.useFakeTimers(),
  useRealTimers: () => jest.useRealTimers(),
  advanceTimersByTime: (ms: number) => jest.advanceTimersByTime(ms),
  advanceTimersByTimeAsync: (ms: number) => jest.advanceTimersByTimeAsync(ms),
  runOnlyPendingTimers: () => jest.runOnlyPendingTimers(),
  runOnlyPendingTimersAsync: () => jest.runOnlyPendingTimersAsync(),
  runAllTimers: () => jest.runAllTimers(),
  runAllTimersAsync: () => jest.runAllTimersAsync(),
};
