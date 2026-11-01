// DO NOT EDIT. Written by `node scripts/sync-web-i18n.mjs` (npm run i18n:sync).
/* eslint-disable */

export type Resources = Record<string, Record<string, unknown>>;

const merge = (...parts: Record<string, unknown>[]): Record<string, unknown> =>
  Object.assign({}, ...parts);

export const loaders: Record<string, () => Resources> = {
  'en-US': () => ({
    interface: merge(require('./en-us/interface/_core.json'), require('./en-us/interface/components.json'), require('./en-us/interface/forms.json'), require('./en-us/interface/panels.json'), require('./en-us/interface/tools.json')),
    error: require('./en-us/error/_core.json'),
    accessibility: merge(require('./en-us/accessibility/_core.json'), require('./en-us/accessibility/components.json')),
    app: require('../../../locales/en-us/app.json'),
  }),
  'uk-UA': () => ({
    interface: merge(require('./uk-ua/interface/_core.json'), require('./uk-ua/interface/components.json'), require('./uk-ua/interface/forms.json'), require('./uk-ua/interface/panels.json'), require('./uk-ua/interface/tools.json')),
    error: require('./uk-ua/error/_core.json'),
    accessibility: merge(require('./uk-ua/accessibility/_core.json'), require('./uk-ua/accessibility/components.json')),
    app: require('../../../locales/uk-ua/app.json'),
  }),
  'ru-RU': () => ({
    interface: merge(require('./ru-ru/interface/_core.json'), require('./ru-ru/interface/components.json'), require('./ru-ru/interface/forms.json'), require('./ru-ru/interface/panels.json'), require('./ru-ru/interface/tools.json')),
    error: require('./ru-ru/error/_core.json'),
    accessibility: merge(require('./ru-ru/accessibility/_core.json'), require('./ru-ru/accessibility/components.json')),
    app: require('../../../locales/ru-ru/app.json'),
  }),
  'he-IL': () => ({
    interface: merge(require('./he-il/interface/_core.json'), require('./he-il/interface/components.json'), require('./he-il/interface/forms.json'), require('./he-il/interface/panels.json'), require('./he-il/interface/tools.json')),
    error: require('./he-il/error/_core.json'),
    accessibility: merge(require('./he-il/accessibility/_core.json'), require('./he-il/accessibility/components.json')),
    app: require('../../../locales/he-il/app.json'),
  }),
  'de-DE': () => ({
    interface: merge(require('./de-de/interface/_core.json'), require('./de-de/interface/components.json'), require('./de-de/interface/forms.json'), require('./de-de/interface/panels.json'), require('./de-de/interface/tools.json')),
    error: require('./de-de/error/_core.json'),
    accessibility: merge(require('./de-de/accessibility/_core.json'), require('./de-de/accessibility/components.json')),
    app: require('../../../locales/de-de/app.json'),
  }),
  'es-ES': () => ({
    interface: merge(require('./es-es/interface/_core.json'), require('./es-es/interface/components.json'), require('./es-es/interface/forms.json'), require('./es-es/interface/panels.json'), require('./es-es/interface/tools.json')),
    error: require('./es-es/error/_core.json'),
    accessibility: merge(require('./es-es/accessibility/_core.json'), require('./es-es/accessibility/components.json')),
    app: require('../../../locales/es-es/app.json'),
  }),
  'es-MX': () => ({
    interface: merge(require('./es-mx/interface/_core.json'), require('./es-mx/interface/components.json'), require('./es-mx/interface/forms.json'), require('./es-mx/interface/panels.json'), require('./es-mx/interface/tools.json')),
    error: require('./es-mx/error/_core.json'),
    accessibility: merge(require('./es-mx/accessibility/_core.json'), require('./es-mx/accessibility/components.json')),
    app: require('../../../locales/es-mx/app.json'),
  }),
  'fr-FR': () => ({
    interface: merge(require('./fr-fr/interface/_core.json'), require('./fr-fr/interface/components.json'), require('./fr-fr/interface/forms.json'), require('./fr-fr/interface/panels.json'), require('./fr-fr/interface/tools.json')),
    error: require('./fr-fr/error/_core.json'),
    accessibility: merge(require('./fr-fr/accessibility/_core.json'), require('./fr-fr/accessibility/components.json')),
    app: require('../../../locales/fr-fr/app.json'),
  }),
  'it-IT': () => ({
    interface: merge(require('./it-it/interface/_core.json'), require('./it-it/interface/components.json'), require('./it-it/interface/forms.json'), require('./it-it/interface/panels.json'), require('./it-it/interface/tools.json')),
    error: require('./it-it/error/_core.json'),
    accessibility: merge(require('./it-it/accessibility/_core.json'), require('./it-it/accessibility/components.json')),
    app: require('../../../locales/it-it/app.json'),
  }),
  'ja-JP': () => ({
    interface: merge(require('./ja-jp/interface/_core.json'), require('./ja-jp/interface/components.json'), require('./ja-jp/interface/forms.json'), require('./ja-jp/interface/panels.json'), require('./ja-jp/interface/tools.json')),
    error: require('./ja-jp/error/_core.json'),
    accessibility: merge(require('./ja-jp/accessibility/_core.json'), require('./ja-jp/accessibility/components.json')),
    app: require('../../../locales/ja-jp/app.json'),
  }),
  'zh-CN': () => ({
    interface: merge(require('./zh-cn/interface/_core.json'), require('./zh-cn/interface/components.json'), require('./zh-cn/interface/forms.json'), require('./zh-cn/interface/panels.json'), require('./zh-cn/interface/tools.json')),
    error: require('./zh-cn/error/_core.json'),
    accessibility: merge(require('./zh-cn/accessibility/_core.json'), require('./zh-cn/accessibility/components.json')),
    app: require('../../../locales/zh-cn/app.json'),
  }),
  'zh-TW': () => ({
    interface: merge(require('./zh-tw/interface/_core.json'), require('./zh-tw/interface/components.json'), require('./zh-tw/interface/forms.json'), require('./zh-tw/interface/panels.json'), require('./zh-tw/interface/tools.json')),
    error: require('./zh-tw/error/_core.json'),
    accessibility: merge(require('./zh-tw/accessibility/_core.json'), require('./zh-tw/accessibility/components.json')),
    app: require('../../../locales/zh-tw/app.json'),
  }),
  'ko-KR': () => ({
    interface: merge(require('./ko-kr/interface/_core.json'), require('./ko-kr/interface/components.json'), require('./ko-kr/interface/forms.json'), require('./ko-kr/interface/panels.json'), require('./ko-kr/interface/tools.json')),
    error: require('./ko-kr/error/_core.json'),
    accessibility: merge(require('./ko-kr/accessibility/_core.json'), require('./ko-kr/accessibility/components.json')),
    app: require('../../../locales/ko-kr/app.json'),
  }),
  'ar-SA': () => ({
    interface: merge(require('./ar-sa/interface/_core.json'), require('./ar-sa/interface/components.json'), require('./ar-sa/interface/forms.json'), require('./ar-sa/interface/panels.json'), require('./ar-sa/interface/tools.json')),
    error: require('./ar-sa/error/_core.json'),
    accessibility: merge(require('./ar-sa/accessibility/_core.json'), require('./ar-sa/accessibility/components.json')),
    app: require('../../../locales/ar-sa/app.json'),
  }),
  'hi-IN': () => ({
    interface: merge(require('./hi-in/interface/_core.json'), require('./hi-in/interface/components.json'), require('./hi-in/interface/forms.json'), require('./hi-in/interface/panels.json'), require('./hi-in/interface/tools.json')),
    error: require('./hi-in/error/_core.json'),
    accessibility: merge(require('./hi-in/accessibility/_core.json'), require('./hi-in/accessibility/components.json')),
    app: require('../../../locales/hi-in/app.json'),
  }),
  'pt-PT': () => ({
    interface: merge(require('./pt-pt/interface/_core.json'), require('./pt-pt/interface/components.json'), require('./pt-pt/interface/forms.json'), require('./pt-pt/interface/panels.json'), require('./pt-pt/interface/tools.json')),
    error: require('./pt-pt/error/_core.json'),
    accessibility: merge(require('./pt-pt/accessibility/_core.json'), require('./pt-pt/accessibility/components.json')),
    app: require('../../../locales/pt-pt/app.json'),
  }),
  'pt-BR': () => ({
    interface: merge(require('./pt-br/interface/_core.json'), require('./pt-br/interface/components.json'), require('./pt-br/interface/forms.json'), require('./pt-br/interface/panels.json'), require('./pt-br/interface/tools.json')),
    error: require('./pt-br/error/_core.json'),
    accessibility: merge(require('./pt-br/accessibility/_core.json'), require('./pt-br/accessibility/components.json')),
    app: require('../../../locales/pt-br/app.json'),
  }),
  'vi-VN': () => ({
    interface: merge(require('./vi-vn/interface/_core.json'), require('./vi-vn/interface/components.json'), require('./vi-vn/interface/forms.json'), require('./vi-vn/interface/panels.json'), require('./vi-vn/interface/tools.json')),
    error: require('./vi-vn/error/_core.json'),
    accessibility: merge(require('./vi-vn/accessibility/_core.json'), require('./vi-vn/accessibility/components.json')),
    app: require('../../../locales/vi-vn/app.json'),
  }),
};
