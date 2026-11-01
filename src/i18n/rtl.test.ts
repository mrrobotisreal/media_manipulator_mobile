import { I18nManager } from 'react-native';
import * as Updates from 'expo-updates';
import { i18n } from './index';
import { setAppLocale } from './setAppLocale';
import { makeReadyStore } from '@/state/testing';

async function setup(isRtl: boolean) {
  const { store } = await makeReadyStore();
  Object.defineProperty(I18nManager, 'isRTL', { value: isRtl, configurable: true });
  jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => {});
  return store;
}

afterEach(async () => {
  jest.restoreAllMocks();
  (Updates.reloadAsync as jest.Mock).mockClear();
  await i18n.changeLanguage('en-US');
});

describe('setAppLocale direction handling', () => {
  it('a flip to RTL asks to confirm, then forceRTL(true) and reloads', async () => {
    const store = await setup(false);
    const confirmRestart = jest.fn().mockResolvedValue(true);
    const r = await setAppLocale('he-IL', {
      dispatch: store.dispatch,
      getState: store.getState,
      confirmRestart,
    });
    expect(confirmRestart).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(store.getState().settings.locale).toBe('he-IL');
    expect(r).toBe('restarting');
  });

  it('a flip back to LTR asks to confirm and forceRTL(false)', async () => {
    const store = await setup(true);
    const confirmRestart = jest.fn().mockResolvedValue(true);
    await setAppLocale('de-DE', {
      dispatch: store.dispatch,
      getState: store.getState,
      confirmRestart,
    });
    expect(confirmRestart).toHaveBeenCalledWith(false);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(Updates.reloadAsync).toHaveBeenCalled();
  });

  it('declining the confirm changes nothing', async () => {
    const store = await setup(false);
    const r = await setAppLocale('ar-SA', {
      dispatch: store.dispatch,
      getState: store.getState,
      confirmRestart: jest.fn().mockResolvedValue(false),
    });
    expect(r).toBe('cancelled');
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
    expect(store.getState().settings.locale).toBeNull();
  });

  it('a same-direction switch is live: no confirm, no reload', async () => {
    const store = await setup(false);
    const confirmRestart = jest.fn();
    const r = await setAppLocale('uk-UA', {
      dispatch: store.dispatch,
      getState: store.getState,
      confirmRestart,
    });
    expect(r).toBe('applied');
    expect(confirmRestart).not.toHaveBeenCalled();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
    expect(i18n.language).toBe('uk-UA');
    expect(i18n.t('tabs.tools')).not.toBe('Tools');
  });
});
