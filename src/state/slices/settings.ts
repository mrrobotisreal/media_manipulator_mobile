import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface SettingsState {
  locale: string | null;
  analyticsOptOut: boolean;
  haptics: boolean;
  lastToolIds: string[];
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
    localeSet(state, action: PayloadAction<string | null>) {
      state.locale = action.payload;
    },
  },
});

export const { hapticsSet, analyticsOptOutSet, localeSet } = settingsSlice.actions;
export default settingsSlice.reducer;
