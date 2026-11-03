import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { pushPrePromptDismissed } from '@/state/slices/settings';
import type { AppDispatch } from '@/state/store';
import { requestPermission } from './permission';
import { runPrePrompt, type PrePromptDeps } from './prePrompt';
import { showPrePrompt, type PromptSurface } from './prePromptStore';
import { tokenManager } from './runtime';

export function realPrePromptDeps(dispatch: AppDispatch): PrePromptDeps {
  return {
    confirm: showPrePrompt,
    request: () => requestPermission(),
    prompted: (surface) => track(EVENTS.PUSH_PERMISSION_PROMPTED, { surface }),
    result: (granted, surface) => track(EVENTS.PUSH_PERMISSION_RESULT, { granted, surface }),
    now: () => Date.now(),
    markDismissed: (at) => void dispatch(pushPrePromptDismissed(at)),
  };
}

/** Pre-prompt, OS dialog, then (when granted) the token is registered right away. */
export async function askForPush(dispatch: AppDispatch, surface: PromptSurface): Promise<boolean> {
  const granted = await runPrePrompt(surface, realPrePromptDeps(dispatch));
  if (granted) void tokenManager.sync();
  return granted;
}
