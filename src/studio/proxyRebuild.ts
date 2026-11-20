// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/proxyRebuild.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * MM71: rebuild an existing video asset's preview proxy with MM70's 1 s
 * keyframe cadence (POST /api/studio/assets/:id/rebuild-proxy).
 *
 * The API names every proxy by generation and reports it on video assets as
 * `proxyGeneration`:
 *   0          written before MM71 (pre-MM70 imports: the encoder's ~8-10 s GOP,
 *              so every preview seek decodes seconds of video)
 *   >= 1       the 1 s keyframe cadence (new imports are 1, each rebuild +1)
 *   absent     an API without the rebuild route (older deploy, or the CreaTV
 *              embed backend). The action is hidden.
 *
 * Proxy responses are cached by the browser for a week (MM70), so a rebuilt
 * proxy must never be fetched under the URL the old bytes were cached under.
 * The proxy and reversed-proxy URLs therefore carry the generation
 * (`?v=g<N>`, ignored by the server), and the preview pool keys its slots by
 * `proxySrcKey`, so a new generation is a new `src` and the MM70 fresh-src path
 * (playbackSync waits for the load instead of re-seeking) handles the switch.
 *
 * Pure apart from the translator flag read in `proxyRebuildAvailable`.
 */
import { isIrreversibleActionHidden } from './mobile/backend';
import type { StudioBackend } from './mobile/backend';

/** The asset fields this module reads. */
export interface ProxyRebuildAsset {
  id: string;
  mediaKind: string;
  proxyGeneration?: number;
}

/** Client lifecycle of one rebuild (server state, never in the EDL). */
export interface ProxyRebuildState {
  state: 'processing' | 'failed';
  jobId?: string;
  /** The generation the asset will have once the job completes. */
  generation?: number;
  /** 0..100 while processing. */
  progress?: number;
}

/**
 * Whether this editor may offer the rebuild at all: the backend declares the
 * capability AND has the route (the MM API; CreaTV's Darkroom API has
 * neither), and this is not a translator deployment (MM52: irreversible
 * Darkroom actions are hidden there).
 */
export function proxyRebuildAvailable(backend: Pick<StudioBackend, 'capabilities' | 'rebuildProxyUrl'>): boolean {
  return backend.capabilities.proxyRebuild === true && typeof backend.rebuildProxyUrl === 'function' && !isIrreversibleActionHidden();
}

/** The asset's proxy generation, or undefined when the API does not report one. */
export function proxyGenerationOf(asset: Pick<ProxyRebuildAsset, 'proxyGeneration'>): number | undefined {
  const g = asset.proxyGeneration;
  return typeof g === 'number' && Number.isInteger(g) && g >= 0 ? g : undefined;
}

/**
 * Whether one bin entry should be offered "Rebuild preview": a ready video
 * whose proxy predates MM71 (generation 0) and that is not rebuilding now.
 * An asset without a reported generation (older API) never qualifies.
 */
export function isProxyRebuildCandidate(entry: {
  asset: ProxyRebuildAsset;
  status: string;
  proxyRebuild?: ProxyRebuildState;
}): boolean {
  return (
    entry.asset.mediaKind === 'video' &&
    entry.status === 'ready' &&
    proxyGenerationOf(entry.asset) === 0 &&
    entry.proxyRebuild?.state !== 'processing'
  );
}

/** Asset ids of every entry that qualifies, in the given order. */
export function proxyRebuildCandidates(
  entries: Iterable<{ asset: ProxyRebuildAsset; status: string; proxyRebuild?: ProxyRebuildState }>,
): string[] {
  const out: string[] = [];
  for (const e of entries) if (isProxyRebuildCandidate(e)) out.push(e.asset.id);
  return out;
}

/**
 * Appends the proxy generation to a proxy URL (`?v=g<N>`), so each generation
 * is its own browser cache entry. Generation 0/absent keeps the bare URL, the
 * one every pre-MM71 client used.
 */
export function versionedProxyUrl(url: string, generation: number | undefined): string {
  if (!url || generation === undefined || generation < 1) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=g${generation}`;
}

/**
 * The decoder-pool source key of an asset's proxy: the asset id plus its
 * generation, and `:r` for the reversed proxy. A slot whose key changes
 * reloads its `src`.
 */
export function proxySrcKey(assetId: string, generation: number | undefined, reversed: boolean): string {
  const g = generation !== undefined && generation >= 1 ? `@g${generation}` : '';
  return `${assetId}${g}${reversed ? ':r' : ''}`;
}

/** Whether a pool source key names a reversed proxy. */
export const isReversedSrcKey = (key: string): boolean => key.endsWith(':r');

/** How one rebuild request ended, for the caller's batch loop. */
export type RebuildRequestOutcome = 'started' | 'unavailable' | 'rate-limited' | 'failed';

/** Maps the rebuild-proxy HTTP status onto the batch outcome. */
export function rebuildOutcomeForStatus(status: number): RebuildRequestOutcome {
  if (status >= 200 && status < 300) return 'started';
  // No route (an API older than MM71) or a backend without it.
  if (status === 404 || status === 405 || status === 501) return 'unavailable';
  if (status === 429) return 'rate-limited';
  return 'failed';
}
