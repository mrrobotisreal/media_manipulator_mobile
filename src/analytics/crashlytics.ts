/**
 * Firebase Crashlytics (ADR MA-0004). Native crashes are automatic; this module sets the runtime
 * collection flag, the user id + attributes, and records JS errors the global handler never sees
 * (error boundary, unhandled rejections). Lazy: nothing touches the native module unless the build
 * has a Firebase config file (MA02's guard; the plugin is only linked then).
 */
import { isFirebaseConfigured } from '@/lib/firebaseAvailable';
import type { AppVariant } from '@/lib/appVariant';

type CrashlyticsModule = typeof import('@react-native-firebase/crashlytics');
type Crashlytics = ReturnType<CrashlyticsModule['getCrashlytics']>;

let mod: CrashlyticsModule | null = null;
let instance: Crashlytics | null = null;

function get(): { m: CrashlyticsModule; c: Crashlytics } | null {
  if (instance && mod) return { m: mod, c: instance };
  if (!isFirebaseConfigured()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@react-native-firebase/crashlytics') as CrashlyticsModule;
    instance = mod.getCrashlytics();
    return { m: mod, c: instance };
  } catch {
    return null;
  }
}

/**
 * Collection off for development builds, on for preview and production (**proposed**: so MA28's
 * test crash from a preview build reaches the console). Instantiating the module also installs
 * RNFirebase's chained JS handler, which must happen BEFORE ours (errorHandlers.ts) so ours runs
 * first and RNFirebase's records the fatal error.
 */
export function initCrashlytics(variant: AppVariant): boolean {
  const x = get();
  if (!x) return false;
  void x.m.setCrashlyticsCollectionEnabled(x.c, variant !== 'development').catch(() => undefined);
  return true;
}

export function crashlyticsIdentify(
  uid: string,
  attrs: { tier: string; locale: string; app_version: string },
): void {
  const x = get();
  if (!x) return;
  void x.m.setUserId(x.c, uid).catch(() => undefined);
  void x.m.setAttributes(x.c, attrs).catch(() => undefined);
}

export function crashlyticsReset(): void {
  const x = get();
  if (!x) return;
  void x.m.setUserId(x.c, '').catch(() => undefined);
}

/** A non-fatal JS error with its stack (Crashlytics, not analytics, keeps stacks). */
export function crashlyticsRecord(error: unknown, name?: string): void {
  const x = get();
  if (!x) return;
  try {
    x.m.recordError(x.c, error instanceof Error ? error : new Error(String(error)), name);
  } catch {
    // never let crash reporting throw
  }
}

/** Test seam. */
export function resetCrashlyticsForTests(): void {
  mod = null;
  instance = null;
}
