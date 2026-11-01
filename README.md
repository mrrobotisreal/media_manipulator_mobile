# Media Manipulator (mobile)

Expo SDK 57 / React Native app (Android first, iOS later) for the Media Manipulator API. See `CONTEXT.md` and `../docs/mobile-app/`.

## Prerequisites

Node 24 (`nvm use`), npm, an Expo account.

## Develop

```
npm ci
npm run gates        # typecheck + lint + jest + expo-doctor
```

## Build a dev client (Mitch only, local build)

There is no paid Expo plan, so builds run on your machine:

```
npx eas-cli@latest build --platform android --profile development --local
```

Install the resulting APK, then `npm start` (dev client).

## Translations

18 locales (the web's). Two sources feed `t()`:

- **Web shards** (`interface:`, `error:`, `accessibility:`) are copied byte-for-byte from `../media-manipulator-ui/i18n/locales/<code>/` into `src/i18n/generated/` (committed; `SOURCE.json` records the web commit). Run `npm run i18n:sync` after web shard changes are merged to web `main`; the npm scripts (sync and the gate check) read the web's committed `main` via `--ref main`, so a web checkout on another branch or with uncommitted work never breaks the gate. `--ref <branch>` (or `MM_WEB_REF`) on the raw script reads another ref. Never edit `src/i18n/generated/`.
- **App strings** live in `locales/<code>/app.json` (namespace `app`, the default), keys grouped by screen. Add a key to all 18 files in the same commit; reuse a web key before adding an app key.

`npm run gates` ends with `node scripts/check-i18n.mjs` (missing/extra keys, placeholders, plural categories, empty values, English-identical values in non-English locales unless listed in `scripts/i18n-allowlist.json`, unknown literal `t()` keys) and `node scripts/sync-web-i18n.mjs --check` (stale copy or registry drift; a clone without the web repo only warns). Dynamic keys must be declared with a `// i18n-keys: a.b, c.d` comment. Non-English app strings are model-written; review state is in `locales/REVIEW.md`.

## Environment

Set as EAS environment variables per profile; never committed. Public defaults are in `.env.example`.

| Name                                                             | Purpose                                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_VARIANT`                                                    | `development`, `preview` or `production` (set by `eas.json` profiles)                                                                                                |
| `EXPO_PUBLIC_API_BASE_URL`                                       | API base, default `https://api.media-manipulator.com/api`                                                                                                            |
| `EXPO_PUBLIC_ANALYTICS_BASE_URL`                                 | Analytics service base                                                                                                                                               |
| `EXPO_PUBLIC_ANALYTICS_WRITE_KEY`                                | Mobile key (production) or mobile-dev key (development/preview)                                                                                                      |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`                               | Google sign-in web client id                                                                                                                                         |
| `EXPO_PUBLIC_APPLE_SERVICE_ID`, `EXPO_PUBLIC_APPLE_REDIRECT_URI` | Apple sign-in                                                                                                                                                        |
| `GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`              | EAS file variables (paths). Locally, `google-services.json` / `GoogleService-Info.plist` in the repo root; gitignored. Without them the app builds without Firebase. |

App ids: `com.mediamanipulator.app` on Android and iOS (variants add `.dev` / `.preview`).

`android/` and `ios/` are generated (CNG) and never committed.
