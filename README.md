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

`android/` and `ios/` are generated (CNG) and never committed.
