import { DELETE_ACCOUNT_WEB_PATH, DELETE_ACCOUNT_WEB_PATH_LIVE, PRIVACY_PATH, TERMS_PATH, webUrl } from './webUrl';

describe('webUrl', () => {
  it('webUrl adds the locale prefix (en none, es-mx, zh-tw)', () => {
    const b = 'https://www.media-manipulator.com';
    expect(webUrl(PRIVACY_PATH, 'en-US', b)).toBe(`${b}/privacy-policy`);
    expect(webUrl(PRIVACY_PATH, 'es-MX', b)).toBe(`${b}/es-mx/privacy-policy`);
    expect(webUrl(TERMS_PATH, 'zh-TW', b)).toBe(`${b}/zh-tw/terms-of-service`);
    expect(webUrl(TERMS_PATH, 'uk-UA', `${b}/`)).toBe(`${b}/uk/terms-of-service`);
    expect(webUrl('privacy-policy', 'xx-XX', b)).toBe(`${b}/privacy-policy`);
  });
  it('the web deletion page link is on (MA26 shipped /delete-account)', () => {
    expect(DELETE_ACCOUNT_WEB_PATH_LIVE).toBe(true);
    expect(webUrl(DELETE_ACCOUNT_WEB_PATH, 'ru-RU', 'https://www.media-manipulator.com')).toBe('https://www.media-manipulator.com/ru/delete-account');
  });
});
