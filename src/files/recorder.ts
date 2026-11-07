/**
 * Microphone recorder controller (ticket MA34 decision 4). Pure state machine over injected deps, so
 * jest drives it with a fake recorder, fake timers and a fake AppState; `useRecorder.ts` binds the real
 * `expo-audio` recorder.
 *
 * Rules: the permission is requested on the first Record tap only (a pre-sheet explains why, in the UI);
 * the clock and the level meter come from the recorder's status, polled every `POLL_MS`; recording
 * auto-stops at `maxSeconds` (60 s, `VOICE_REFERENCE_MAX_SECONDS`); the app going to the background stops
 * the take (never a background recording: no foreground service, no `enableBackgroundRecording`).
 */
import { referenceLengthVerdict, type ReferenceLengthVerdict } from '@/tools/voices/consent';

export const POLL_MS = 100;
/** Metering floor in dBFS: -60 dB or less reads as silence (0), 0 dB as full scale (1). */
export const METER_FLOOR_DB = -60;

export type RecorderPhase =
  'idle' | 'requesting' | 'denied' | 'blocked' | 'recording' | 'recorded' | 'error';

export interface RecorderState {
  phase: RecorderPhase;
  elapsedMs: number;
  /** 0..1 */
  level: number;
  /** `file://` of the finished take. */
  uri: string | null;
  durationSec: number;
  verdict: ReferenceLengthVerdict | null;
  /** True when the take ended because the app left the foreground. */
  interrupted: boolean;
  /** True when the take ended at the length ceiling. */
  autoStopped: boolean;
}

export const initialRecorderState: RecorderState = {
  phase: 'idle',
  elapsedMs: 0,
  level: 0,
  uri: null,
  durationSec: 0,
  verdict: null,
  interrupted: false,
  autoStopped: false,
};

/** The slice of `expo-audio`'s AudioRecorder the controller uses. */
export interface RecorderLike {
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
  getStatus(): { durationMillis: number; metering?: number; url?: string | null };
  uri: string | null;
}

export interface RecorderDeps {
  requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  recorder: RecorderLike;
  /** Switches the audio session to/from recording (`setAudioModeAsync({allowsRecording})`). */
  setRecordingMode(on: boolean): Promise<void>;
  /** Subscribes to AppState; returns the unsubscribe. */
  onAppState(cb: (state: string) => void): () => void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Called with every state change. */
  onChange(state: RecorderState): void;
  maxSeconds: number;
}

/** dBFS (usually -160..0) to a 0..1 bar. */
export function meterLevel(db: number | undefined): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

export function createRecorderController(deps: RecorderDeps) {
  let state: RecorderState = initialRecorderState;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  let stopping = false;
  let started = false;

  const set = (patch: Partial<RecorderState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };
  const clearTimer = () => {
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
  };
  const teardown = () => {
    clearTimer();
    unsubscribe?.();
    unsubscribe = null;
  };

  async function finish(flags: { interrupted?: boolean; autoStopped?: boolean }) {
    if (stopping || state.phase !== 'recording') return;
    stopping = true;
    clearTimer();
    const status = deps.recorder.getStatus();
    const ms = Math.min(status.durationMillis, deps.maxSeconds * 1000);
    try {
      await deps.recorder.stop();
      const uri = deps.recorder.uri ?? deps.recorder.getStatus().url ?? null;
      const durationSec = (flags.autoStopped ? deps.maxSeconds * 1000 : ms) / 1000;
      teardown();
      await deps.setRecordingMode(false).catch(() => undefined);
      if (!uri) {
        set({ phase: 'error', level: 0 });
        return;
      }
      set({
        phase: 'recorded',
        uri,
        elapsedMs: durationSec * 1000,
        durationSec,
        level: 0,
        verdict: referenceLengthVerdict(durationSec),
        interrupted: flags.interrupted ?? false,
        autoStopped: flags.autoStopped ?? false,
      });
    } catch {
      teardown();
      await deps.setRecordingMode(false).catch(() => undefined);
      set({ phase: 'error', level: 0 });
    } finally {
      stopping = false;
    }
  }

  function poll() {
    if (state.phase !== 'recording') return;
    const s = deps.recorder.getStatus();
    set({ elapsedMs: s.durationMillis, level: meterLevel(s.metering) });
    if (s.durationMillis >= deps.maxSeconds * 1000) void finish({ autoStopped: true });
  }

  return {
    get state() {
      return state;
    },
    /** First Record tap: permission, then record. Denied / blocked are terminal until the next tap. */
    async start(): Promise<void> {
      if (state.phase === 'recording' || state.phase === 'requesting') return;
      set({ ...initialRecorderState, phase: 'requesting' });
      let perm;
      try {
        perm = await deps.requestPermission();
      } catch {
        set({ phase: 'error' });
        return;
      }
      if (!perm.granted) {
        set({ phase: perm.canAskAgain ? 'denied' : 'blocked' });
        return;
      }
      try {
        await deps.setRecordingMode(true);
        await deps.recorder.prepareToRecordAsync();
        deps.recorder.record();
      } catch {
        await deps.setRecordingMode(false).catch(() => undefined);
        set({ phase: 'error' });
        return;
      }
      started = true;
      set({ phase: 'recording', elapsedMs: 0, level: 0 });
      timer = deps.setInterval(poll, POLL_MS);
      unsubscribe = deps.onAppState((s) => {
        if (s !== 'active') void finish({ interrupted: true });
      });
    },
    /** Stop & keep the take (verdict decides whether it can be used). */
    stop(): Promise<void> {
      return finish({});
    },
    /** Drops the take / any error and returns to idle. */
    discard(): void {
      teardown();
      if (state.phase === 'recording' && started) {
        void deps.recorder.stop().catch(() => undefined);
        void deps.setRecordingMode(false).catch(() => undefined);
      }
      set({ ...initialRecorderState });
    },
    /** Unmount: stop quietly, no state change. */
    dispose(): void {
      const was = state.phase === 'recording';
      teardown();
      if (was) {
        void deps.recorder.stop().catch(() => undefined);
        void deps.setRecordingMode(false).catch(() => undefined);
      }
    },
  };
}

export type RecorderController = ReturnType<typeof createRecorderController>;
