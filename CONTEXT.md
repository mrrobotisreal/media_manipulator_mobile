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
- **Intake** (MA11): getting a user file into the app as an `IntakeFile`: a stable `file://` copy under `cache/intake/<id>/` (never a `content://` URI), made by `src/files/intake.ts` before any check that needs the bytes. A 24 h sweep (start + foreground) deletes unreferenced copies.
- **Share-into** (MA11): Android `ACTION_SEND` / `SEND_MULTIPLE` via `expo-share-intent` 8.x. The plugin receives `*/*` and `src/files/share-intent.ts` filters by MIME in JS; a share is held in memory until `auth.status === 'ready'`, then routed to `app/(app)/intake.tsx`. iOS share extension is MA36.
- **Pre-flight check** (MA11): pure `src/files/preflight.ts` run before any upload: `unsupported_type`, `too_large`, `too_long`, `empty`, `too_many`, against the cached `/account/me` limits. Skipped (never guessed) while the snapshot loads; a failed duration probe never blocks.
- **Job record** (MA12): one `JobRecord` in the persisted `jobs` slice (`src/jobs/types.ts`), keyed by **local job id**; carries the lifecycle `state`, upload/server progress, the last server snapshot and the built options (so Try again re-sends the same job). The newest 50 persist.
- **Local job id** (MA12): `local_<uuid>`, created by `startJobs()` before the server assigns `jobId`; `findJob` accepts either id (the job route and push deep links).
- **Job state** (MA12): `queued -> uploading -> (finalizing) -> pending | processing -> completed | failed`; side exits `rejected` (API refused the upload; MA16 renders it), `upload_failed` (retryable), `lost`, `cancelled`, `stopped`. Only `transition()` moves a record.
- **Lost job** (MA12): a persisted `pending`/`processing` job whose `GET /job/:id` is 404 (the API's job map is in memory). `lostReason` `server_restarted` (< 24 h since accepted) or `expired`.
- **Stop watching** (MA12): after acceptance there is no server cancel; the app drops tracking (`stopped`), the job still runs and counts. Before acceptance, Cancel aborts the upload (no job, no charge).
- **Result descriptor** (MA13): `describe()` in `src/results/describe.ts`, the pure answer to "what did this job produce?": kind from the result file extension first, then the registry row's `webTask`, then `resultHint`; never from Content-Type. Port of the web file.
- **Result kind** (MA13): the descriptor's `ResultKind` (`image|gif|video|audio|pdf|archive|transcript|captions|metadata|summary|hls|dash|unknown`); it picks the viewer.
- **Viewer** (MA13): a component in `src/results/viewers/` chosen by `viewerFor(kind)`; unregistered or not-yet-built kinds render `UnknownViewer`. Image/gif/pdf/archive download into `cache/results/<jobId>/`; video/audio stream `GET /result/:id` with owner headers when the API sniffed a MIME.
- **Compare** (MA13): image-only wipe/toggle of the result against the original copy kept in `cache/originals/<jobId>/`; wipe values are logical percentages (0 = start edge).
- **Job engine** (MA12): `src/jobs/jobEngine.ts`, plain TypeScript over an injected `JobTransport`; one upload at a time, SSE for the watched job (fallback 2 s poll after an error or 60 s silence), 5 s poll for the rest, nothing while backgrounded. `runtime.ts` wires the real store/native modules; `useJob(id)` watches while a screen is mounted.

## Layout

`app/` Expo Router routes ((auth), (app)/(tabs)); `src/ui` tokens and base components; `src/state` Redux store, MMKV persistence, slices; `src/lib` ids, user agent, locale, Firebase availability; `src/api` baseQuery, errors, Zod schemas, `mmApi` endpoints; `src/analytics` stub `track`; `src/tools` registry, search, recents (MA10); `src/files` intake, pre-flight, share-into, FileArea (MA11); `src/jobs` upload transport, SSE parser, job engine, restore (MA12).

## Ids

Android package and iOS bundle id are both `com.mediamanipulator.app`; the `development` and `preview` variants append `.dev` / `.preview` (`com.mediamanipulator.app.dev`, `com.mediamanipulator.app.preview`). Slug `media-manipulator`, scheme `mediamanipulator`. Both are single constants (`ANDROID_PACKAGE`, `IOS_BUNDLE_ID`) in `app.config.ts`.
- **Save to Photos** (MA14): image/gif/video results go to the gallery via `expo-media-library` (add-only permission asked at the first save; Android album "Media Manipulator"). Denied: a sheet offers Open settings or Save to Files instead.
- **Save to Files** (MA14): everything else. Android picks a Storage Access Framework folder once (`settings.lastSaveDirUri`) and writes into it; iOS opens the share sheet. Pure logic in `src/files/save.ts`, native bindings in `src/files/saveDeps.ts`.
- **Share link** (MM32, MA14): "Copy share link" mints a public expiring `/r/<token>` URL (`POST /jobs/:id/share`, 5 live per job, revoke all with `DELETE`); only the URL is copied, never the file name. Distinct from the **share sheet** (shares the file itself).
- **Notice** (MA14): the app's toast: `showNotice(text, tone)` in `src/ui/notice.ts`, rendered by `NoticeHost` in the signed-in layout.
