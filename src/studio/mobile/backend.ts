/**
 * The phone's side of the web's `studioBackend` seam (ticket MA61 decision 2).
 *
 * `scripts/sync-studio.mjs` rewrites two web imports of the copied Darkroom files to this module:
 * `@/lib/studio/studioBackend` (previewEngine's proxy / sprite / peaks URL builders, proxyRebuild's
 * types) and `@/lib/translator/mode` (proxyRebuild's translator-deployment check). It therefore
 * exports the same names with the same shapes, limited to what the copies read.
 *
 * URLs only: the media routes need the owner headers (Bearer + session ids), and those are applied
 * by the fetchers (`assets.ts` / `buildHeaders()`), never put into a URL.
 */
import { API_BASE_URL } from '@/api/config';

/** The subset of the web's `StudioBackendCapabilities` the copied files read. */
export interface StudioBackendCapabilities {
  reverseProxy: boolean;
  proxyRebuild: boolean;
  peaks: boolean;
  lut: boolean;
}

/** The subset of the web's `StudioBackend` the copied files read (the URL builders). */
export interface StudioBackend {
  ecosystem: 'mm';
  baseUrl: string;
  capabilities: StudioBackendCapabilities;
  proxyUrl: (assetId: string) => string;
  proxyReversedUrl?: (assetId: string) => string;
  rebuildProxyUrl?: (assetId: string) => string;
  spriteUrl: (assetId: string) => string;
  peaksUrl?: (assetId: string) => string;
  assetFileUrl?: (assetId: string) => string;
}

const enc = encodeURIComponent;

/** The MM API backend: the same routes as the web's `createMmBackend()`, on the app's API origin. */
export function createAppStudioBackend(baseUrl: string = API_BASE_URL): StudioBackend {
  const asset = (id: string, suffix: string) => `${baseUrl}/studio/assets/${enc(id)}/${suffix}`;
  return {
    ecosystem: 'mm',
    baseUrl,
    capabilities: { reverseProxy: true, proxyRebuild: true, peaks: true, lut: true },
    proxyUrl: (id) => asset(id, 'proxy'),
    proxyReversedUrl: (id) => asset(id, 'proxy-reversed'),
    rebuildProxyUrl: (id) => asset(id, 'rebuild-proxy'),
    spriteUrl: (id) => asset(id, 'sprite'),
    peaksUrl: (id) => asset(id, 'peaks'),
    assetFileUrl: (id) => asset(id, 'file'),
  };
}

let active: StudioBackend | null = null;

/** Same signature as the web: the lazily created default backend. */
export function getActiveStudioBackend(): StudioBackend {
  if (!active) active = createAppStudioBackend();
  return active;
}

/** Test seam (and a future embed): replace the active backend; `null` restores the default. */
export function setActiveStudioBackend(backend: StudioBackend | null): void {
  active = backend;
}

/**
 * The web's translator-deployment rule (`lib/translator/mode.ts`, MM52): irreversible actions are
 * hidden on translator deployments. The app is never one.
 */
export function isIrreversibleActionHidden(): boolean {
  return false;
}
