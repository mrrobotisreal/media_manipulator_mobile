# CLAUDE.md: Media Manipulator mobile app

Expo SDK 57 / React Native dev-client app. Read `CONTEXT.md`, then the planning docs in `../docs/mobile-app/` (ticket for your task in `tickets/`).

## Run from and gates

- Run from this directory. Node 24 (`.nvmrc`), npm.
- `npm run gates` = typecheck + lint + jest + `npx expo-doctor`. Also keep `npx expo install --check` clean. Install Expo-managed packages with `npx expo install`.

## Hard rules

- Agents never start Metro, emulators, dev builds or EAS builds, and never touch Mitch's phones. Builds are Mitch's and **local only** (`npx eas-cli@latest build --platform android --profile development --local`); there is no paid Expo plan, so never add cloud-only build steps. `eas init`, `eas credentials`, `eas env:*` and `eas update` are fine.
- Never push. Never merge to `main` unless the ticket's flow says so (`--no-ff` after green gates). No destructive git commands.
- CNG: `android/` and `ios/` are never committed and never generated into the repo (`expo prebuild` is not run here).
- Secrets: never read, print or commit `.env*`, `google-services.json`, `GoogleService-Info.plist`, keystores or tokens. Name the variable instead (`GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`, `EXPO_PUBLIC_*`).
- The API (`../media_manipulator_api/`) is the source of truth for contracts; never invent endpoints.
- Analytics event names only through `src/analytics/events.ts` once it exists (MA07).
- User-visible strings: English literals tagged `// i18n: MA05` until MA05, then 18 locales. Use logical styles (`start`/`end`, `ps`/`pe`), never left/right.
- Use `Text`/`Button` from `src/ui/components`, not react-native's (lint-enforced in `app/` and `src/features`).
- `useFrameworks: 'static'` (iOS) is react-native-firebase's requirement; keep it.
- App ids: `com.mediamanipulator.app` (Android and iOS), never `com.media_manipulator.app` / `com.media-manipulator.app`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Merge green work to `main` before the final report (merge-on-completion).

## Knowledge graph

Query `graphify-out/graph.json` before grepping (`graphify query "..." --graph graphify-out/graph.json`). Finish every session with `/graphify . --update` (split per subfolder and `graphify merge-graphs` if it chokes). Never commit `graphify-out/`.
