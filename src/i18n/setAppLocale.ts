import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';
import * as Updates from 'expo-updates';
import { accountApi } from '@/api/endpoints/account';
import { mmApi } from '@/api/mmApi';
import type { AppDispatch, RootState } from '@/state/store';
import { localeSet } from '@/state/slices/settings';
import { changeAppLanguage, i18n } from './index';
import { isRtlLocale } from './locales';
import { resolveLocale } from './resolveLocale';

export interface SetAppLocaleDeps {
  dispatch: AppDispatch;
  getState: () => RootState;
  /** Shows the "Restart to switch layout direction" sheet; resolves true when confirmed. */
  confirmRestart: (nextIsRtl: boolean) => Promise<boolean>;
  /** Flushes redux-persist so the override survives the reload. */
  flush?: () => Promise<unknown>;
}

export type SetAppLocaleResult = 'applied' | 'restarting' | 'cancelled';

/**
 * Applies a locale override (null = follow the system). A direction flip (to/from he-IL, ar-SA)
 * asks to confirm, persists, calls `forceRTL` and reloads; a same-direction switch is live.
 */
export async function setAppLocale(
  code: string | null,
  { dispatch, getState, confirmRestart, flush }: SetAppLocaleDeps,
): Promise<SetAppLocaleResult> {
  const next = resolveLocale(code, Localization.getLocales());
  const nextIsRtl = isRtlLocale(next);

  if (nextIsRtl !== I18nManager.isRTL) {
    if (!(await confirmRestart(nextIsRtl))) return 'cancelled';
    dispatch(localeSet(code));
    await flush?.();
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(nextIsRtl);
    await Updates.reloadAsync();
    return 'restarting';
  }

  dispatch(localeSet(code));
  await changeAppLanguage(i18n, next);
  // Account responses are localized via Accept-Language: refetch in the new one.
  dispatch(mmApi.util.invalidateTags(['Account']));
  if (getState().auth.status === 'ready') {
    // Lightweight re-sync so the API stores the new email language; errors ignored.
    void dispatch(accountApi.endpoints.syncAccount.initiate({ locale: next })).catch(() => {});
  }
  return 'applied';
}
