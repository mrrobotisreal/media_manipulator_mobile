# Media Manipulator mobile app: context

Expo / React Native client (Android first, iOS later) for the Media Manipulator API. Planning, tickets, ADRs and design docs live in `../docs/mobile-app/` (roadmap, `design/ARCHITECTURE.md`, `adr/MA-0001`..`MA-0009`).

## Vocabulary

- **App**: this repo's Expo application. Store name "Media Manipulator"; launcher label `MediaManip` (`MediaManip Dev` / `MediaManip Preview` for the other variants).
- **Variant**: `development | preview | production`, selected by `APP_VARIANT` in `app.config.ts`. Each has its own ids, scheme and EAS profile, so all three install side by side.
- **Tool**: one media operation (e.g. compress video) exposed by the API; grouped into **Families** (video, audio, image, caption, document).
- **Job**: one server-side run of a Tool on an upload; has status, progress and a **Result** (downloadable output).
- **Quota metric**: what the API meters, `ops` or `ai_ops`. **Tier**: the account plan reported in `X-MM-Tier`.
- **Sync gate**: after Firebase sign-in the app calls `POST /api/account/sync`; `(app)` routes render only when `auth.status === 'ready'`.
- **Visitor id**: per-install UUIDv4 (persisted). **Session id**: UUIDv4 created at cold start.
- **Dev shell**: the `__DEV__`-only "Open app shell" button on the sign-in placeholder; removed by MA04.
- The word "Darkroom" never appears in the app UI. `Darkroom Instrument` is only the name of the design-token system (`src/ui/tokens.ts`), ported from the web.

## Layout

`app/` Expo Router routes ((auth), (app)/(tabs)); `src/ui` tokens and base components; `src/state` Redux store, MMKV persistence, slices; `src/lib` ids, Firebase availability.
