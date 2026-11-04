# CLAUDE.md: Media Manipulator mobile app

Expo SDK 57 / React Native dev-client app. Read `CONTEXT.md`, then the planning docs in `../docs/mobile-app/` (ticket for your task in `tickets/`).

## Run from and gates

- Run from this directory. Node 24 (`.nvmrc`), npm.
- `npm run gates` = typecheck + lint + jest + `npx expo-doctor` + both i18n checks. Also keep `npx expo install --check` clean. Install Expo-managed packages with `npx expo install`.

## Hard rules

- Agents run EAS builds themselves, **local only** (`npx eas-cli@latest build --platform android --profile development --local`), and install them on Mitch's connected test phone with `adb install -r` (never clear its data or uninstall without asking). Never a cloud build: there is no paid Expo plan, so never add cloud-only build steps. Delete the build output afterwards (disk is tight). `eas init`, `eas credentials` and `eas env:*` are fine; `eas update` / `eas submit` publish to users, so confirm with Mitch first.
- Never push. Never merge to `main` unless the ticket's flow says so (`--no-ff` after green gates). No destructive git commands.
- CNG: `android/` and `ios/` are never committed and never generated into the repo (`expo prebuild` is not run here).
- Secrets: never read, print or commit `.env*`, `google-services.json`, `GoogleService-Info.plist`, keystores or tokens. Name the variable instead (`GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`, `EXPO_PUBLIC_*`).
- The API (`../media_manipulator_api/`) is the source of truth for contracts; never invent endpoints.
- Analytics: names only through `src/analytics/events.ts` (`track(EVENTS.X, …)`; a lint rule forbids inline names). **Catalog first**: a new name or property is added to `../media-manipulator-analytics/internal/catalog/catalog.go` (+ `appRolloutBatches`), merged and deployed BEFORE it appears in `events.ts`; then run `MM_APP_EVENTS_TS=$(pwd)/src/analytics/events.ts go test ./internal/catalog/ -run TestAppEventsParity` from the analytics repo and refresh `__fixtures__/analytics-catalog.fixture.json`. Properties: enums, buckets, counts and ids only, never file names, emails or display names.
- User-visible strings: every new string goes through `t()` and into all 18 `locales/<code>/app.json` in the same commit (reuse a web key from `interface|error|accessibility` first; `npm run gates` enforces it). Never edit `src/i18n/generated/` (run `npm run i18n:sync`). Use logical styles (`start`/`end`, `ms`/`me`, `ps`/`pe`), never left/right (a test enforces it).
- Use `Text`/`Button` from `src/ui/components`, not react-native's (lint-enforced in `app/` and `src/features`).
- `useFrameworks: 'static'` (iOS) is react-native-firebase's requirement; keep it.
- App ids: `com.mediamanipulator.app` (Android and iOS), never `com.media_manipulator.app` / `com.media-manipulator.app`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Merge green work to `main` before the final report (merge-on-completion).

## Knowledge graph

Query `graphify-out/graph.json` before grepping (`graphify query "..." --graph graphify-out/graph.json`). Finish every session with `/graphify . --update` (split per subfolder and `graphify merge-graphs` if it chokes). Never commit `graphify-out/`.
