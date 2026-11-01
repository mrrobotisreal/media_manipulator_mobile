import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface SettingsState {
  locale: string | null;
  analyticsOptOut: boolean;
  haptics: boolean;
  lastToolIds: string[];
}

export const MAX_RECENT_TOOLS = 6;

/** Most recent first, de-duplicated, capped. Pure so the reducer and tests share it. */
export function pushRecentTool(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT_TOOLS);
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState: {
    locale: null,
    analyticsOptOut: false,
    haptics: true,
    lastToolIds: [],
  } as SettingsState,
  reducers: {
    hapticsSet(state, action: PayloadAction<boolean>) {
      state.haptics = action.payload;
    },
    analyticsOptOutSet(state, action: PayloadAction<boolean>) {
      state.analyticsOptOut = action.payload;
    },
    toolOpened(state, action: PayloadAction<string>) {
      state.lastToolIds = pushRecentTool(state.lastToolIds, action.payload);
    },
    localeSet(state, action: PayloadAction<string | null>) {
      state.locale = action.payload;
    },
  },
});

export const { hapticsSet, analyticsOptOutSet, localeSet, toolOpened } = settingsSlice.actions;
export default settingsSlice.reducer;
