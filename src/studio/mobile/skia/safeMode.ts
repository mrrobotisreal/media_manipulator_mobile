/**
 * Darkroom preview safe mode (ticket MA62 decision 11, design §6): a single-slot preview of the
 * top-most visible clip, effects off, titles on, with a neutral "Simplified preview" chip. Entered
 * when the GPU editors are unavailable (`gpuEditors()`, MA60), when the measured preview fps stays
 * under 15 for 5 s while playing, or by the user's toggle; left only by the toggle (an automatic
 * entry stays for the session: a phone that could not hold 15 fps would flap otherwise).
 *
 * Pure: fed fps samples and the capability answer by the preview's JS timer, so jest drives it
 * with a fake fps source. `studio_safe_mode_entered {reason}` fires once per entry reason per
 * session (the catalog's rule).
 */

export const LOW_FPS = 15;
export const LOW_FPS_FOR_MS = 5000;

export type SafeModeReason = 'gpu_unavailable' | 'low_fps' | 'user_toggle';

export interface SafeModeState {
  on: boolean;
  reason: SafeModeReason | null;
  /** When the playing fps first dropped under LOW_FPS in the current run (ms), else null. */
  lowSinceMs: number | null;
  /** Reasons already reported this session. */
  reported: SafeModeReason[];
}

export const initialSafeMode = (): SafeModeState => ({ on: false, reason: null, lowSinceMs: null, reported: [] });

export interface SafeModeStep {
  state: SafeModeState;
  /** The entry to report (`studio_safe_mode_entered`), if this step entered and it is new. */
  report: SafeModeReason | null;
}

function enter(s: SafeModeState, reason: SafeModeReason): SafeModeStep {
  if (s.on) return { state: s, report: null };
  const fresh = !s.reported.includes(reason);
  return {
    state: { on: true, reason, lowSinceMs: null, reported: fresh ? [...s.reported, reason] : s.reported },
    report: fresh ? reason : null,
  };
}

/** The capability answer arrived (or was already known). */
export function onCapability(s: SafeModeState, gpu: 'ok' | 'unavailable' | null): SafeModeStep {
  return gpu === 'unavailable' ? enter(s, 'gpu_unavailable') : { state: s, report: null };
}

/**
 * One fps measurement (the preview's ~1 s window). `playing`: the timeline was playing for the whole
 * window; paused, seeking and the first window after play() never count (nothing is decoding then).
 */
export function onFps(s: SafeModeState, fps: number, playing: boolean, nowMs: number): SafeModeStep {
  if (s.on) return { state: s, report: null };
  if (!playing || !(fps >= 0)) return { state: { ...s, lowSinceMs: null }, report: null };
  if (fps >= LOW_FPS) return { state: s.lowSinceMs === null ? s : { ...s, lowSinceMs: null }, report: null };
  const since = s.lowSinceMs ?? nowMs;
  if (nowMs - since >= LOW_FPS_FOR_MS) return enter(s, 'low_fps');
  return { state: s.lowSinceMs === null ? { ...s, lowSinceMs: since } : s, report: null };
}

/** The user's toggle. Turning it off is allowed from any reason except a GPU that is not there. */
export function onToggle(s: SafeModeState, on: boolean, gpu: 'ok' | 'unavailable' | null): SafeModeStep {
  if (on) return enter(s, 'user_toggle');
  if (gpu === 'unavailable') return { state: s, report: null };
  return { state: { ...s, on: false, reason: null, lowSinceMs: null }, report: null };
}
