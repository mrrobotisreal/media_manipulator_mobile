import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { getAppState } from '@/api/stateRef';
import { sessionRotated, touched } from '@/state/slices/session';

/** AUTH §3: a session ends after 30 minutes without activity (background or idle). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** `session.lastActiveAt` is persisted (redux-persist); write it at most once a minute. */
export const TOUCH_PERSIST_MS = 60 * 1000;

let dispatch: Dispatch<UnknownAction> | null = null;
let mem: { sessionId: string; at: number } | null = null;

/** store.ts registers its dispatch (like `registerStateGetter`). */
export function registerSessionDispatch(d: Dispatch<UnknownAction>): void {
  dispatch = d;
  mem = null;
}

/**
 * The one place `sessionId` rotates (MA07 decision 6): called on every `track`, on every API
 * request (`buildHeaders`) and on foreground. After ≥ 30 min without activity the `session` slice
 * gets a new id, which is what MA03's `X-MM-Session-ID` header and analytics `session_id` both read.
 * Returns the ids to stamp, or null before the store exists.
 */
export function ensureFreshSession(
  now: number = Date.now(),
): { visitorId: string; sessionId: string } | null {
  const state = getAppState();
  if (!state) return null;
  let { sessionId } = state.session;
  if (!mem || mem.sessionId !== sessionId) {
    // First call, or another path rotated it (sign-out): start from the persisted activity time.
    mem = { sessionId, at: state.session.lastActiveAt };
  }
  if (now - mem.at >= SESSION_IDLE_MS && dispatch) {
    dispatch(sessionRotated(now));
    sessionId = getAppState()?.session.sessionId ?? sessionId;
    mem = { sessionId, at: now };
  } else {
    mem.at = Math.max(mem.at, now);
    if (dispatch && now - state.session.lastActiveAt >= TOUCH_PERSIST_MS) dispatch(touched(now));
  }
  return { visitorId: state.session.visitorId, sessionId };
}

/** Persist the activity time now (going to background: a killed app still knows when it was last used). */
export function persistActivity(now: number = Date.now()): void {
  if (dispatch && getAppState()) dispatch(touched(now));
  if (mem) mem.at = Math.max(mem.at, now);
}

/** Test seam. */
export function resetSessionKeeperForTests(): void {
  mem = null;
}
