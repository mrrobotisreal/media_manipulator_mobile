/**
 * A heal in flight that must outlive backgrounding and an app kill (ticket MA56 decision 2).
 *
 * The editor writes `{jobId, projectId, base, startedAt}` to MMKV `photoHealPending:<projectId>`
 * right after `POST …/heal` answers, before it polls; it clears the record when the job settles
 * (installed, failed, or no longer applicable). `photoHealJobs` maps a job id to its project so
 * a `photo_heal` push tap can open the right editor without the network. Pure over an injected
 * key-value store (`mmkvStorage` in the app, a Map in tests).
 */
import { EVENTS, type PhotoFailReason } from '@/analytics/events';
import { PHOTO_TOOL_SLUG } from '@/analytics/photoEvents';
import { track } from '@/analytics/track';
import { msBucket } from './exportPlan';

export interface HealKv {
  getItem(key: string): Promise<string | null | undefined>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

export interface PendingHeal {
  jobId: string;
  projectId: string;
  /** The base hash the heal started from ('' = the original). */
  base: string;
  /** Epoch ms the heal was requested (the `photo_heal_completed` duration bucket). */
  startedAt: number;
  /** `context.tool_slug` of the editor that started it. */
  slug?: string;
}

export const PHOTO_HEAL_TOOL = 'photo_heal';
export const pendingHealKey = (projectId: string) => `photoHealPending:${projectId}`;
export const HEAL_JOBS_KEY = 'photoHealJobs';
/** Older records are dropped: the API's job is long gone by then. */
export const PENDING_HEAL_TTL_MS = 24 * 60 * 60_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[A-Za-z0-9_-]{0,64}$/;

const parse = (text: string | null | undefined): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

function asPending(v: unknown): PendingHeal | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const { jobId, projectId, base, startedAt, slug } = r;
  if (typeof jobId !== 'string' || !ID.test(jobId)) return null;
  if (typeof projectId !== 'string' || !ID.test(projectId)) return null;
  if (typeof base !== 'string' || !HASH.test(base)) return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return { jobId, projectId, base, startedAt, ...(typeof slug === 'string' ? { slug } : {}) };
}

async function readIndex(kv: HealKv): Promise<Record<string, string>> {
  const v = parse(await kv.getItem(HEAL_JOBS_KEY).catch(() => null));
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>))
    if (typeof p === 'string') out[k] = p;
  return out;
}

async function writeIndex(kv: HealKv, index: Record<string, string>): Promise<void> {
  if (Object.keys(index).length === 0) await kv.removeItem(HEAL_JOBS_KEY).catch(() => undefined);
  else await kv.setItem(HEAL_JOBS_KEY, JSON.stringify(index)).catch(() => undefined);
}

/** The project's pending heal, or null (expired or unreadable records are removed). */
export async function readPendingHeal(
  kv: HealKv,
  projectId: string,
  now: number = Date.now(),
): Promise<PendingHeal | null> {
  const raw = await kv.getItem(pendingHealKey(projectId)).catch(() => null);
  if (!raw) return null;
  const rec = asPending(parse(raw));
  if (!rec || rec.projectId !== projectId || now - rec.startedAt > PENDING_HEAL_TTL_MS) {
    await clearPendingHeal(kv, projectId, rec?.jobId);
    return null;
  }
  return rec;
}

/** One pending heal per project: a new heal replaces the previous record. */
export async function savePendingHeal(kv: HealKv, rec: PendingHeal): Promise<void> {
  const prev = asPending(parse(await kv.getItem(pendingHealKey(rec.projectId)).catch(() => null)));
  await kv.setItem(pendingHealKey(rec.projectId), JSON.stringify(rec)).catch(() => undefined);
  const index = await readIndex(kv);
  if (prev && prev.jobId !== rec.jobId) delete index[prev.jobId];
  index[rec.jobId] = rec.projectId;
  await writeIndex(kv, index);
}

/** Remove the project's record; with `jobId`, only when it is still that job's record. */
export async function clearPendingHeal(
  kv: HealKv,
  projectId: string,
  jobId?: string,
): Promise<void> {
  const cur = asPending(parse(await kv.getItem(pendingHealKey(projectId)).catch(() => null)));
  if (!jobId || !cur || cur.jobId === jobId)
    await kv.removeItem(pendingHealKey(projectId)).catch(() => undefined);
  const index = await readIndex(kv);
  let changed = false;
  for (const [j, p] of Object.entries(index))
    if (p === projectId && (!jobId || j === jobId || j === cur?.jobId)) {
      delete index[j];
      changed = true;
    }
  if (changed) await writeIndex(kv, index);
}

/** What a `photo_heal` job says about itself (`GET /job/:id`: `options {tool, projectId, base}`). */
export interface HealJobInfo {
  options: Record<string, unknown>;
}

/**
 * A `photo_heal` push tap: the job's project. The local index first (no network: the heal this
 * phone started and has not installed yet); else the job's `options.projectId`. The tap only opens
 * the editor, which resumes the project's pending record: a heal already installed (or started
 * elsewhere) is never re-installed from a tap. Null when the job is not a project heal.
 */
export async function resolveHealProject(
  kv: HealKv,
  jobId: string,
  fetchJob: (jobId: string) => Promise<HealJobInfo>,
): Promise<string | null> {
  const local = (await readIndex(kv))[jobId];
  if (local && ID.test(local)) return local;
  const o = (await fetchJob(jobId)).options ?? {};
  const projectId = typeof o.projectId === 'string' ? o.projectId : '';
  if (!ID.test(projectId) || (o.tool !== undefined && o.tool !== PHOTO_HEAL_TOOL)) return null;
  return projectId;
}

/**
 * `photo_heal_completed` / `photo_heal_failed` for a heal settled by the editor, timed from the
 * record's `startedAt` (the request event fired when the heal was started, maybe in an earlier
 * process). Names through `EVENTS`, props as `trackPhotoHeal`'s.
 */
export function trackHealSettled(
  rec: Pick<PendingHeal, 'startedAt' | 'slug'>,
  outcome: { ok: true } | { ok: false; reason: PhotoFailReason },
  now: number = Date.now(),
): void {
  const ctx = { tool_slug: rec.slug ?? PHOTO_TOOL_SLUG, feature: 'photo' };
  const ms = msBucket(Math.max(0, now - rec.startedAt));
  if (outcome.ok) track(EVENTS.PHOTO_HEAL_COMPLETED, { ms }, ctx);
  else track(EVENTS.PHOTO_HEAL_FAILED, { ms, reason: outcome.reason }, ctx);
}
