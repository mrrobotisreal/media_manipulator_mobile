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
- The word "Darkroom" never appears in the app UI. `Darkroom Instrument` is only the name of the design-token system (`src/ui/tokens.ts`), ported from the web.
- **MmError**: the one error shape from `src/api/errors.ts` (`{status, code, message?, details}`); every API failure is normalised to it. Screens switch on **error code** (`MmErrorCode`: client codes like `network`, `rate_limited`, `contract_mismatch`, the API's snake_case codes, or `api:<code>` for ones this build does not know), never on English text.
- **Quota observation**: on every 2xx the baseQuery reads `X-MM-Tier` / `X-MM-Quota-*` and dispatches `quota/observed`; on other failures it invalidates the `Account` tag instead.
- **Token provider**: `setIdTokenProvider(fn)` in `src/api/authToken.ts`; MA04 registers Firebase's `getIdToken`. `buildHeaders()` (in `baseQuery.ts`) is the only place request headers are built, including for uploads, SSE and downloads.

- **Web shard**: a JSON file copied by `scripts/sync-web-i18n.mjs` from the web's `i18n/locales/<code>/` into `src/i18n/generated/`; namespaces `interface`, `error`, `accessibility`. Read-only here; translator-workbench edits arrive on the next sync.
- **App shard**: `locales/<code>/app.json`, namespace `app` (default); app-only strings, keys grouped by screen, present in all 18 locales.
- **Locale override**: `settings.locale` (null = follow the system); resolved by `resolveLocale` and applied by `setAppLocale`.
- **RTL reload**: switching to or from he-IL / ar-SA flips layout direction, which needs a confirm sheet, `I18nManager.forceRTL` and `Updates.reloadAsync()`; same-direction switches are live.
- **Sync gate** (MA04): `src/auth/syncGate.ts` follows Firebase auth state: `unknown -> signedOut | syncing -> ready | syncFailed`. Sync retries 1 s, 3 s, 9 s; a 401 fails immediately. `signupSource` is the method just used, else the first `providerData` entry (`methods.ts`).
- **Linking**: on `auth/account-exists-with-different-credential` the pending credential is held in memory in `src/auth/linking.ts`; after the user signs in with the other method it is linked. Android Apple (web flow) has no credential, so a "Link Apple" offer appears instead.
- **Re-auth**: `reauthenticate({kind})` in `src/auth/reauth.ts` returns a fresh ID token (`auth_time` < 5 min) for account deletion (MA22).
- **Session expired**: MA03's `auth/sessionExpired` action; `src/auth/gate.ts` signs the user out and the sign-in screen shows a notice.
- **Firebase boundary**: only `src/auth/*` imports `@react-native-firebase/auth` and google-signin (lint-enforced); the jest manual mocks live in `__mocks__/`.
- **Tool row** (MA10): one `ToolDefinition` in `src/tools/registry.ts` (38 in v1), built in `src/tools/families/{image,video,audio,ai,metadata}.ts`. A **family** is one of those five groups (Tools tab sections, route segment `tool/<family>/<toolId>`).
- **Preset** (MA10 type only): a named `Partial<defaults>` variant of a tool for a folded web page, with its own analytics slug.
- **Analytics slug**: the web tool slug a row reports as `context.tool_slug` (first folded slug, never an alias in the web's `TOOL_ALIAS_OF`); keeps web and app funnels comparable.
- **Endpoint `auto`**: presign for a video file, multipart upload otherwise (`resolveTransport`).

## Layout

`app/` Expo Router routes ((auth), (app)/(tabs)); `src/ui` tokens and base components; `src/state` Redux store, MMKV persistence, slices; `src/lib` ids, user agent, locale, Firebase availability; `src/api` baseQuery, errors, Zod schemas, `mmApi` endpoints; `src/analytics` stub `track`; `src/tools` registry, search, recents (MA10).

## Ids

Android package and iOS bundle id are both `com.mediamanipulator.app`; the `development` and `preview` variants append `.dev` / `.preview` (`com.mediamanipulator.app.dev`, `com.mediamanipulator.app.preview`). Slug `media-manipulator`, scheme `mediamanipulator`. Both are single constants (`ANDROID_PACKAGE`, `IOS_BUNDLE_ID`) in `app.config.ts`.
