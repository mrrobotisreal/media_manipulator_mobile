import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface SettingsState {
  locale: string | null;
  analyticsOptOut: boolean;
  haptics: boolean;
  lastToolIds: string[];
  /** Android Save to Files: the SAF folder the user picked last (MA14); reused until a write fails. */
  lastSaveDirUri: string | null;
  /** MA24: when the user said "Not now" to (or the OS denied) the push pre-prompt; no auto-ask for 30 days. */
  pushPrePromptDismissedAt: number | null;
}

export const MAX_RECENT_TOOLS = 6;

/** Most recent first, de-duplicated, capped. Pure so the reducer and tests share it. */
export function pushRecentTool(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT_TOOLS);
}

export const initialSettingsState = (): SettingsState => ({
  locale: null,
  analyticsOptOut: false,
  haptics: true,
  lastToolIds: [],
  lastSaveDirUri: null,
  pushPrePromptDismissedAt: null,
});

const settingsSlice = createSlice({
  name: 'settings',
  initialState: initialSettingsState,
  reducers: {
    /** Account deletion (MA22): every setting back to its default. */
    settingsReset() {
      return initialSettingsState();
    },
    hapticsSet(state, action: PayloadAction<boolean>) {
      state.haptics = action.payload;
    },
    analyticsOptOutSet(state, action: PayloadAction<boolean>) {
      state.analyticsOptOut = action.payload;
    },
    toolOpened(state, action: PayloadAction<string>) {
      state.lastToolIds = pushRecentTool(state.lastToolIds, action.payload);
    },
    saveDirSet(state, action: PayloadAction<string | null>) {
      state.lastSaveDirUri = action.payload;
    },
    pushPrePromptDismissed(state, action: PayloadAction<number>) {
      state.pushPrePromptDismissedAt = action.payload;
    },
    localeSet(state, action: PayloadAction<string | null>) {
      state.locale = action.payload;
    },
  },
});

export const {
  hapticsSet,
  analyticsOptOutSet,
  localeSet,
  pushPrePromptDismissed,
  saveDirSet,
  settingsReset,
  toolOpened,
} = settingsSlice.actions;
export default settingsSlice.reducer;
