import type { ConversionJob } from '@/api/schemas/job';
import type { MmError } from '@/api/errors';
import * as events from '@/analytics/jobEvents';
import { resolveTransport } from '@/tools/resolveTransport';
import type { AnyToolDefinition, ToolOptions } from '@/tools/types';
import type { IntakeFile } from '@/files/types';
import { optionsHash } from './optionsHash';
import { lostReasonFor, restoreJobs } from './restore';
import { isServerActive, isTerminal, transition, type JobEvent, type JobRecord } from './types';
import type { Failure, JobTransport } from './transport';
import { runUpload } from './upload';

export const SSE_SILENCE_MS = 60_000;
export const SSE_POLL_MS = 2_000;
export const LIST_POLL_MS = 5_000;
export const PROGRESS_THROTTLE_MS = 250;

export interface JobStore {
  get(localId: string): JobRecord | undefined;
  all(): JobRecord[];
  put(record: JobRecord): void;
}

export interface JobEngineDeps {
  transport: JobTransport;
  store: JobStore;
  now(): number;
  /** Subscribes to foreground/background; returns unsubscribe. */
  appState: {
    current(): 'active' | 'background' | 'inactive';
    subscribe(cb: (s: string) => void): () => void;
  };
  /** Subscribes to connectivity; the callback fires on every change with `isConnected`. */
  network: { subscribe(cb: (connected: boolean) => void): () => void };
  /** Android only: keeps the screen on while an upload runs. */
  keepAwake?: { activate(): void; release(): void };
  files: {
    exists(uri: string): boolean;
    release(intakeId: string): void;
    /** Image originals move to `cache/originals/<jobId>/` for MA13's compare. */
    keepOriginal(record: JobRecord): void;
  };
  /** After completed/failed: invalidate Account and History. */
  onSettled(record: JobRecord): void;
  activation: {
    uid(): string | null;
    signupAt(): number | null;
    /** True exactly once per uid (persisted flag). */
    claim(uid: string): Promise<boolean>;
  };
  /** MA16's quota pre-flight hook: a returned error rejects the job before any bytes move. */
  beforeUpload?: (record: JobRecord) => Promise<MmError | null>;
  newId(): string;
  /** Starters by name (`StartInput.starter`); MA50 registers `photoExport`. */
  starters?: Readonly<Record<string, JobStarter>>;
}

export interface StartInput {
  tool: Pick<AnyToolDefinition, 'id' | 'family' | 'analyticsSlug' | 'endpoint' | 'optionsBuilder'>;
  file: IntakeFile;
  /** Already built (`tool.optionsBuilder(form)`). */
  options: ToolOptions;
  /**
   * MA50 starter seam (MA29 decision 5): the job is created by this registered starter's JSON
   * request instead of a file upload; the rest (tracking, restore, result) is unchanged. `file`
   * then describes the source the result compares against (it is never uploaded).
   */
  starter?: string;
  /** Optional `options_hash` override (a starter's documented recipe); default FNV of `options`. */
  optionsHash?: string;
}

/** A registered starter: sends the request that creates the server job. */
export interface JobStarter {
  start(record: JobRecord, signal: AbortSignal): Promise<{ ok: true; jobId: string } | Failure>;
  /**
   * Once per job, after the engine's own events, when it ends `completed` / `failed` (server) or
   * `rejected` / `upload_failed` (the start request): the starter's feature events go here.
   */
  settled?(record: JobRecord): void;
}

type TrackerKind = 'sse' | 'poll2' | 'poll5';
interface Tracker {
  kind: TrackerKind | null;
  sse?: { close(): void };
  silence?: ReturnType<typeof setTimeout>;
  poll?: ReturnType<typeof setTimeout>;
  /** SSE failed for this watch; stay on 2 s polling until unwatch. */
  sseFailed: boolean;
  stopped: boolean;
}

export function createJobEngine(deps: JobEngineDeps) {
  const { store, transport } = deps;
  const queue: string[] = [];
  const trackers = new Map<string, Tracker>();
  let current: { localId: string; abort: AbortController } | null = null;
  let started = false;
  const unsubs: (() => void)[] = [];
  const lastProgressAt = new Map<string, number>();

  const foreground = () => deps.appState.current() === 'active';

  function apply(localId: string, event: JobEvent): JobRecord | undefined {
    const rec = store.get(localId);
    if (!rec) return undefined;
    const next = transition(rec, event);
    store.put(next);
    return next;
  }

  // ---------------------------------------------------------------- upload queue

  function startJobs(inputs: StartInput[]): string[] {
    const ids: string[] = [];
    const batchId = inputs.length > 1 ? `batch_${deps.newId()}` : undefined;
    for (const { tool, file, options, starter, optionsHash: hash } of inputs) {
      const t = starter ? 'starter' : resolveTransport(tool, file.mediaKind);
      if (t === 'metadataInspect')
        throw new Error('metadataInspect does not run through the job engine');
      if (t === 'photoProject')
        throw new Error('photoProject tools open the Aperture editor, not a job');
      if (starter && !deps.starters?.[starter]) throw new Error(`unknown job starter ${starter}`);
      const localId = `local_${deps.newId()}`;
      store.put({
        localId,
        batchId,
        toolId: tool.id,
        family: tool.family,
        analyticsSlug: tool.analyticsSlug,
        transport: t === 'presign' ? 'presigned_put' : t === 'starter' ? 'starter' : 'post',
        ...(starter ? { starter } : {}),
        intakeFileId: file.id,
        fileUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType,
        sourceExtension: file.extension,
        sizeBytes: file.sizeBytes,
        mediaKind: file.mediaKind,
        options,
        optionsHash: hash ?? optionsHash(options),
        state: 'queued',
        uploadProgress: 0,
        progress: 0,
        createdAt: deps.now(),
        watch: false,
      });
      queue.push(localId);
      ids.push(localId);
    }
    void pump();
    return ids;
  }

  async function pump(): Promise<void> {
    if (current) return;
    const localId = queue.shift();
    if (!localId) {
      deps.keepAwake?.release();
      return;
    }
    const rec = store.get(localId);
    if (!rec || rec.state !== 'queued') return pump();
    const abort = new AbortController();
    current = { localId, abort };
    deps.keepAwake?.activate();
    try {
      await runOne(localId, abort);
    } catch {
      // a defect here must not wedge the queue
    } finally {
      current = null;
      void pump();
    }
  }

  async function runOne(localId: string, abort: AbortController): Promise<void> {
    let rec = apply(localId, { type: 'upload_start', at: deps.now() });
    if (!rec) return;
    if (rec.transport === 'starter') return runStarter(localId, rec, abort);
    events.trackUploadStarted(rec);
    const startedAt = rec.uploadStartedAt ?? deps.now();
    const elapsed = () => deps.now() - startedAt;

    const guard = await deps.beforeUpload?.(rec);
    if (guard) return reject(localId, guard, elapsed());
    if (abort.signal.aborted) return;
    // The cached copy can be gone (swept, or handed to an earlier job); say so instead of "no connection".
    if (!deps.files.exists(rec.fileUri)) {
      events.trackUploadFailed(rec, 'file_gone', elapsed());
      apply(localId, {
        type: 'upload_failed',
        error: { status: 'FETCH_ERROR', code: 'file_gone', details: {} },
      });
      return;
    }

    const outcome = await runUpload(transport, rec.transport, rec, {
      signal: abort.signal,
      now: deps.now,
      onProgress: (fraction) => {
        const t = deps.now();
        if (fraction < 1 && t - (lastProgressAt.get(localId) ?? 0) < PROGRESS_THROTTLE_MS) return;
        lastProgressAt.set(localId, t);
        if (store.get(localId)?.state === 'uploading')
          apply(localId, { type: 'progress', fraction });
      },
      onBytesSent: () => {
        const cur = store.get(localId);
        if (!cur || cur.state !== 'uploading') return;
        events.trackUploadCompleted(cur, elapsed());
        if (cur.transport === 'presigned_put') apply(localId, { type: 'upload_sent' });
      },
    });
    lastProgressAt.delete(localId);

    rec = store.get(localId);
    // Cancelled (or otherwise moved on) while the transfer was in flight: nothing more to do.
    if (!rec || rec.state === 'cancelled') return;
    if (outcome.ok) return accepted(localId, outcome.jobId);
    if (outcome.kind === 'cancelled') return;
    events.trackUploadFailed(rec, outcome.reason, elapsed(), outcome.status);
    if (outcome.kind === 'rejected') {
      apply(localId, { type: 'rejected', error: outcome.error });
      deps.files.release(rec.intakeFileId);
    } else {
      apply(localId, { type: 'upload_failed', error: outcome.error });
    }
  }

  /**
   * A starter job (MA50): one JSON request creates the server job. No bytes move, so no upload_*
   * events; the starter's own feature events (e.g. photo_export_*) bracket it. The quota
   * pre-flight still applies (an export costs one `ops`).
   */
  async function runStarter(
    localId: string,
    rec: JobRecord,
    abort: AbortController,
  ): Promise<void> {
    const guard = await deps.beforeUpload?.(rec);
    if (guard) {
      const ended = apply(localId, { type: 'rejected', error: guard });
      if (ended) starterSettled(ended);
      return;
    }
    const starter = rec.starter ? deps.starters?.[rec.starter] : undefined;
    if (!starter) {
      apply(localId, {
        type: 'rejected',
        error: { status: 'FETCH_ERROR', code: 'unknown', details: { starter: rec.starter } },
      });
      return;
    }
    let outcome: Awaited<ReturnType<JobStarter['start']>>;
    try {
      outcome = await starter.start(rec, abort.signal);
    } catch (e) {
      outcome = {
        ok: false,
        kind: 'failed',
        error: {
          status: 'FETCH_ERROR',
          code: 'unknown',
          message: e instanceof Error ? e.message : undefined,
          details: {},
        },
        reason: 'unknown',
      };
    }
    const cur = store.get(localId);
    if (!cur || cur.state === 'cancelled') return;
    if (outcome.ok) return accepted(localId, outcome.jobId);
    if (outcome.kind === 'cancelled') return;
    const ended = apply(localId, {
      type: outcome.kind === 'rejected' ? 'rejected' : 'upload_failed',
      error: outcome.error,
    });
    if (ended) starterSettled(ended);
  }

  function starterSettled(rec: JobRecord): void {
    const hook = rec.starter ? deps.starters?.[rec.starter]?.settled : undefined;
    try {
      hook?.(rec);
    } catch {
      // analytics never breaks the flow
    }
  }

  function reject(localId: string, error: MmError, durationMs: number): void {
    const rec = store.get(localId);
    if (!rec) return;
    events.trackUploadFailed(rec, error.code, durationMs);
    apply(localId, { type: 'rejected', error });
    deps.files.release(rec.intakeFileId);
  }

  function accepted(localId: string, jobId: string): void {
    const rec = apply(localId, { type: 'accepted', jobId, at: deps.now() });
    if (!rec) return;
    events.trackJobStarted(rec);
    // The retry copy is no longer needed; image originals wait for completion (MA13 compare).
    if (rec.mediaKind !== 'image') deps.files.release(rec.intakeFileId);
    ensureTracking(localId);
  }

  function cancel(localId: string): void {
    const rec = store.get(localId);
    if (!rec || (rec.state !== 'queued' && rec.state !== 'uploading')) return;
    const wasUploading = rec.state === 'uploading';
    apply(localId, { type: 'cancel' });
    const i = queue.indexOf(localId);
    if (i >= 0) queue.splice(i, 1);
    if (wasUploading) {
      events.trackUploadFailed(rec, 'cancelled', deps.now() - (rec.uploadStartedAt ?? deps.now()));
      if (current?.localId === localId) current.abort.abort();
    }
    deps.files.release(rec.intakeFileId);
  }

  /** Re-enqueue an `upload_failed` job from its cached copy. Returns false when the copy is gone. */
  function retry(localId: string): boolean {
    const rec = store.get(localId);
    if (!rec || rec.state !== 'upload_failed') return false;
    if (rec.transport !== 'starter' && !deps.files.exists(rec.fileUri)) {
      store.put({
        ...rec,
        error: { status: 'FETCH_ERROR', code: 'file_gone', details: {} },
      });
      return false;
    }
    apply(localId, { type: 'retry' });
    queue.push(localId);
    void pump();
    return true;
  }

  // ---------------------------------------------------------------- tracking

  function tracker(localId: string): Tracker {
    let t = trackers.get(localId);
    if (!t) {
      t = { kind: null, sseFailed: false, stopped: false };
      trackers.set(localId, t);
    }
    return t;
  }

  function teardown(localId: string): void {
    const t = trackers.get(localId);
    if (!t) return;
    t.stopped = true;
    t.sse?.close();
    clearTimeout(t.silence);
    clearTimeout(t.poll);
    trackers.delete(localId);
  }

  function teardownAll(): void {
    for (const id of [...trackers.keys()]) teardown(id);
  }

  function desiredKind(rec: JobRecord, t: Tracker): TrackerKind {
    if (!rec.watch) return 'poll5';
    return t.sseFailed ? 'poll2' : 'sse';
  }

  function ensureTracking(localId: string): void {
    const rec = store.get(localId);
    if (!rec || !isServerActive(rec.state) || !rec.jobId || !foreground() || !started) {
      return;
    }
    const t = tracker(localId);
    const want = desiredKind(rec, t);
    if (t.kind === want) return;
    // Switch: stop the old mechanism, start the new one.
    t.sse?.close();
    t.sse = undefined;
    clearTimeout(t.silence);
    clearTimeout(t.poll);
    t.kind = want;
    if (want === 'sse') openStream(localId, t);
    else schedulePoll(localId, t, want === 'poll2' ? SSE_POLL_MS : LIST_POLL_MS, want === 'poll2');
  }

  function armSilence(localId: string, t: Tracker): void {
    clearTimeout(t.silence);
    t.silence = setTimeout(() => sseFailed(localId, t), SSE_SILENCE_MS);
  }

  function openStream(localId: string, t: Tracker): void {
    const rec = store.get(localId);
    if (!rec?.jobId) return;
    armSilence(localId, t);
    t.sse = transport.openJobEvents(rec.jobId, {
      onSnapshot: (job) => {
        if (t.stopped) return;
        armSilence(localId, t);
        applySnapshot(localId, job);
      },
      onActivity: () => {
        if (!t.stopped) armSilence(localId, t);
      },
      onError: (error) => {
        if (t.stopped) return;
        if (error.status === 404) return handleNotFound(localId);
        sseFailed(localId, t);
      },
      onClose: () => {
        // The server closes only after the terminal snapshot; anything else means we missed it.
        if (!t.stopped) sseFailed(localId, t);
      },
    });
  }

  function sseFailed(localId: string, t: Tracker): void {
    if (t.stopped) return;
    t.sseFailed = true;
    ensureTracking(localId);
  }

  function schedulePoll(localId: string, t: Tracker, ms: number, immediate: boolean): void {
    const run = async () => {
      if (t.stopped) return;
      const rec = store.get(localId);
      if (!rec?.jobId || !isServerActive(rec.state)) return;
      const res = await transport.fetchJob(rec.jobId);
      if (t.stopped) return;
      if (res.ok) applySnapshot(localId, res.job);
      else if (res.error.status === 404) return handleNotFound(localId);
      if (!t.stopped && trackers.get(localId) === t) t.poll = setTimeout(run, ms);
    };
    if (immediate) void run();
    else t.poll = setTimeout(run, ms);
  }

  function handleNotFound(localId: string): void {
    const rec = store.get(localId);
    if (!rec || !isServerActive(rec.state)) return;
    teardown(localId);
    apply(localId, { type: 'lost', reason: lostReasonFor(rec, deps.now()) });
    deps.files.release(rec.intakeFileId);
  }

  function applySnapshot(localId: string, job: ConversionJob): void {
    const rec = store.get(localId);
    if (!rec || !isServerActive(rec.state)) return;
    if (
      rec.job?.status === job.status &&
      rec.job.progress === job.progress &&
      rec.job.currentStage === job.currentStage
    ) {
      return;
    }
    const next = apply(localId, { type: 'snapshot', job, at: deps.now() });
    if (!next || !isTerminal(next.state)) return;
    teardown(localId);
    settle(next, job);
  }

  function settle(rec: JobRecord, job: ConversionJob): void {
    const duration = (rec.completedAt ?? deps.now()) - (rec.acceptedAt ?? rec.createdAt);
    if (rec.state === 'completed') {
      events.trackJobCompleted(rec, job, duration);
      void activate(rec);
      if (rec.mediaKind === 'image') deps.files.keepOriginal(rec);
    } else {
      // The server's error text can echo file names, so it never goes to analytics; dev logs only.
      if (__DEV__) console.warn('[job] failed', job.id, job.currentStage ?? '', job.error ?? '');
      events.trackJobFailed(rec, job, duration);
      deps.files.release(rec.intakeFileId);
    }
    if (rec.transport === 'starter') starterSettled(rec);
    deps.onSettled(rec);
  }

  async function activate(rec: JobRecord): Promise<void> {
    const uid = deps.activation.uid();
    if (!uid) return;
    try {
      if (await deps.activation.claim(uid)) {
        events.trackActivation(rec, deps.activation.signupAt(), deps.now());
      }
    } catch {
      // analytics never breaks the flow
    }
  }

  function watch(localId: string): void {
    const rec = store.get(localId);
    if (!rec || rec.watch) return;
    store.put({ ...rec, watch: true });
    const t = trackers.get(localId);
    if (t) t.sseFailed = false;
    ensureTracking(localId);
  }

  function unwatch(localId: string): void {
    const rec = store.get(localId);
    if (!rec || !rec.watch) return;
    store.put({ ...rec, watch: false });
    const t = trackers.get(localId);
    if (t) t.sseFailed = false;
    ensureTracking(localId);
  }

  function stopWatching(localId: string): void {
    const rec = store.get(localId);
    if (!rec || !isServerActive(rec.state)) return;
    teardown(localId);
    apply(localId, { type: 'stop' });
    deps.files.release(rec.intakeFileId);
  }

  // ---------------------------------------------------------------- lifecycle

  /** Foreground / reconnect: refetch each non-terminal job once, then resume tracking. */
  async function refreshAll(): Promise<void> {
    const active = store.all().filter((r) => isServerActive(r.state) && r.jobId);
    await Promise.all(
      active.map(async (r) => {
        const res = await transport.fetchJob(r.jobId!);
        if (res.ok) applySnapshot(r.localId, res.job);
        else if (res.error.status === 404) handleNotFound(r.localId);
      }),
    );
    for (const r of store.all()) ensureTracking(r.localId);
  }

  /** Call once after `auth.status === 'ready'`; restores persisted jobs and starts listening. */
  async function start(): Promise<void> {
    if (started) return;
    started = true;
    unsubs.push(
      deps.appState.subscribe((s) => {
        if (s === 'active') void refreshAll();
        else if (s === 'background') teardownAll();
      }),
      deps.network.subscribe((connected) => {
        if (connected && foreground()) void refreshAll();
      }),
    );
    await restoreJobs({
      records: () => store.all(),
      fetchJob: (id) => transport.fetchJob(id),
      apply: (localId, job) => applySnapshot(localId, job),
      markLost: (localId, reason) => {
        const rec = store.get(localId);
        if (!rec) return;
        teardown(localId);
        apply(localId, { type: 'lost', reason });
      },
      now: deps.now,
    });
    for (const r of store.all()) ensureTracking(r.localId);
  }

  /** Sign-out: stop everything. Uploads in flight are aborted. */
  function stop(): void {
    started = false;
    teardownAll();
    unsubs.splice(0).forEach((u) => u());
    queue.length = 0;
    current?.abort.abort();
    deps.keepAwake?.release();
  }

  return {
    startJobs,
    cancel,
    retry,
    watch,
    unwatch,
    stopWatching,
    start,
    stop,
    /** Test/diagnostic: the current tracking mechanism for a job. */
    trackingKind: (localId: string) => trackers.get(localId)?.kind ?? null,
  };
}

export type JobEngine = ReturnType<typeof createJobEngine>;
