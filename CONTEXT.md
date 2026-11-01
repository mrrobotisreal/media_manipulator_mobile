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
- **MmError**: the one error shape from `src/api/errors.ts` (`{status, code, message?, details}`); every API failure is normalised to it. Screens switch on **error code** (`MmErrorCode`: client codes like `network`, `rate_limited`, `contract_mismatch`, the API's snake_case codes, or `api:<code>` for ones this build does not know), never on English text.
- **Quota observation**: on every 2xx the baseQuery reads `X-MM-Tier` / `X-MM-Quota-*` and dispatches `quota/observed`; on other failures it invalidates the `Account` tag instead.
- **Token provider**: `setIdTokenProvider(fn)` in `src/api/authToken.ts`; MA04 registers Firebase's `getIdToken`. `buildHeaders()` (in `baseQuery.ts`) is the only place request headers are built, including for uploads, SSE and downloads.

## Layout

`app/` Expo Router routes ((auth), (app)/(tabs)); `src/ui` tokens and base components; `src/state` Redux store, MMKV persistence, slices; `src/lib` ids, user agent, locale, Firebase availability; `src/api` baseQuery, errors, Zod schemas, `mmApi` endpoints; `src/analytics` stub `track`.

## Ids

Android package and iOS bundle id are both `com.mediamanipulator.app`; the `development` and `preview` variants append `.dev` / `.preview` (`com.mediamanipulator.app.dev`, `com.mediamanipulator.app.preview`). Slug `media-manipulator`, scheme `mediamanipulator`. Both are single constants (`ANDROID_PACKAGE`, `IOS_BUNDLE_ID`) in `app.config.ts`.
