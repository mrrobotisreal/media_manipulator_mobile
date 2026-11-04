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

## Aperture (MA50–MA52)

The `photo.*` (MA50, MA51) and `tools.aperture.*`, `history.segments.*`, `history.projects.*`,
`history.tool.photo_export`, `result.editAgain` (MA52) strings are model-written in all 17 non-English
locales (Opus 5.5 subagents); ru-RU, de-DE, ja-JP, ar-SA and he-IL were read by the implementing
session, none by a native speaker yet. Same status as the table above: **not reviewed**.

MA52 glossary pass (2026-11-04): the Aperture words follow the web's synced shard
(`src/i18n/generated/<code>/interface/panels.json`, `photo.*`), pinned per locale by
`src/photo/__tests__/glossary.test.ts` (Mask, Layer, Preset = the web's "Looks", Heal, Curves, Levels;
the Exposure, slider and layer labels are read from the shard itself). Aligned to the web in that pass:
de-DE strip "Stile" → "Looks", "Kurven" → "Gradationskurven", "Tonwerte" → "Tonwertkorrektur";
pt-BR / pt-PT "Estilos" → "Looks"; ja-JP "カーブ" → "トーンカーブ", "レベル" → "レベル補正";
hi-IN "कर्व" → "कर्व्स", "लेवल" → "लेवल्स"; vi-VN "Mức sáng" → "Mức". The entry-row titles are the
web's localized MM100 page names (`i18n/locales/<code>/toolPages.ts` `name`). "Looks" in de-DE / pt-BR /
pt-PT is the web's own (English-identical) term and allowlisted by key.

| Locale             | Aperture strings reviewed | Reviewer | Date |
| ------------------ | ------------------------- | -------- | ---- |
| all 17 non-English | no (model-written)        |          |      |

MA53 (2026-11-04): `photo.presets.*` (account presets, the MMKV migration prompt, Upload, the cap line
`photo.presets.cap_*` with each locale's CLDR plural categories, offline) model-written in the 17
non-English locales by one Opus 5.5 subagent, mirroring the web shard's `photo.presets.*` words and
address form (so de-DE uses "Sie" here, like the web, while older app strings use "du"); ru-RU, de-DE,
ja-JP, ar-SA and he-IL read by the implementing session. **Not reviewed** by a native speaker.
