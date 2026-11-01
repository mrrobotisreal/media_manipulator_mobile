# App-string review list

`locales/<code>/app.json` strings are model-written (Claude) for every non-English locale. The web's
"reviewed" status (`src/i18n/locales.ts`) covers the synced web shards only, not these. A native
speaker reviews each locale; record the result here.

| Locale                                                                             | Reviewed                                   | Reviewer | Date |
| ---------------------------------------------------------------------------------- | ------------------------------------------ | -------- | ---- |
| en-US                                                                              | n/a (source copy, binding from the ticket) |          |      |
| uk-UA, ru-RU, de-DE                                                                | no                                         |          |      |
| he-IL, ar-SA (RTL)                                                                 | no                                         |          |      |
| es-ES, es-MX, fr-FR, it-IT, ja-JP, zh-CN, zh-TW, ko-KR, hi-IN, pt-PT, pt-BR, vi-VN | no                                         |          |      |

Notes: `placeholders.*` strings are temporary scaffolding (they name later tickets) and are replaced as those
screens land. `it-IT` keeps "Account" (native usage; allowlisted in `scripts/i18n-allowlist.json`).
