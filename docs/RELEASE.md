# Release runbook (MA25)

Agents run `eas build` themselves, on the laptop, and install the result on the test phone. **Builds are always local (`--local`), never cloud** (no paid Expo plan). `eas update` and `eas submit` publish to users: confirm with Mitch first.
eas-cli at writing: 27.4.0 (`npx eas-cli@latest` or `npm i -g eas-cli`). Project `media-manipulator`, owner `mwintrow`, id in `app.config.ts`.

## 1. One-time setup

1. `eas login`; `eas whoami` shows `mwintrow`. `extra.eas.projectId` is already in `app.config.ts` (`npx expo config --type public | grep projectId`).
2. **EAS environment variables** (Project -> Environment variables, or `eas env:create --environment <env> --name <NAME> --value <v> --visibility plaintext`).
   Set each in all three environments (`development`, `preview`, `production`); values are never in git or `eas.json`:

   | Name                               | development / preview                                                       | production                                |
   | ---------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
   | `EXPO_PUBLIC_API_BASE_URL`         | API base URL                                                                | same                                      |
   | `EXPO_PUBLIC_ANALYTICS_BASE_URL`   | analytics base URL                                                          | same                                      |
   | `EXPO_PUBLIC_ANALYTICS_WRITE_KEY`  | the **mobile-dev** write key                                                | the **mobile** write key (set 2026-11-03) |
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | web OAuth client id                                                         | same                                      |
   | `EXPO_PUBLIC_APPLE_SERVICE_ID`     | Apple Services ID (Apple on Android)                                        | same                                      |
   | `EXPO_PUBLIC_WEB_BASE_URL`         | optional (default `https://www.media-manipulator.com`)                      | same                                      |
   | `GOOGLE_SERVICES_JSON`             | **file** variable: `eas env:create --type file` with `google-services.json` | same                                      |
   | `GOOGLE_SERVICE_INFO_PLIST`        | file variable, iOS only (MA35+)                                             | same                                      |

   Check: `eas env:list --environment production`.

3. **Android keystores and Google sign-in** (each build variant has its own package id, so its own keystore and its own Firebase Android app):

   | Variant     | Package                            | Firebase app                |
   | ----------- | ---------------------------------- | --------------------------- |
   | development | `com.mediamanipulator.app.dev`     | "... Dev"                   |
   | preview     | `com.mediamanipulator.app.preview` | "... Preview"               |
   | production  | `com.mediamanipulator.app`         | "Media Manipulator Android" |

   For each: `eas credentials -p android` -> pick the build profile (`development` / `preview` / `production`) -> Keystore -> view the keystore;
   copy the **SHA-1** and **SHA-256**. Then Firebase console -> Project settings -> Your apps -> the matching Android app -> **Add fingerprint**
   (paste SHA-1, repeat for SHA-256). Re-download `google-services.json` and re-upload it to the `GOOGLE_SERVICES_JSON` file variable
   (`eas env:update`). A preview keystore was created on 2026-11-03 by a cancelled build: view it rather than creating another.
   Without the fingerprint Google sign-in fails with `DEVELOPER_ERROR`. Email sign-in is unaffected.
   **Production / Play App Signing:** Google re-signs the store build with its own key. After the first upload (MA27), Play Console -> Test and release ->
   App signing -> copy the **app signing key** SHA-1/SHA-256 into the production Firebase app too (MA27 does this).

4. Play service account for `eas submit`: uploaded to EAS by Mitch in MA27 (never in git).

## 2. Build (local)

`google-services.json` is gitignored, so EAS does not copy it into the local build's sandbox: without it the sandbox config has no Firebase and the build fails with "Runtime version mismatch" in the Configure expo-updates phase. Until the `GOOGLE_SERVICES_JSON` file variable exists in the EAS environment, point the variable at the local file for every local build: prefix the command with `GOOGLE_SERVICES_JSON="$PWD/google-services.json"`. Remove any stale `android/` directory first (it is gitignored, but it feeds the fingerprint).

```sh
npx eas-cli@latest build --profile preview --platform android --local      # APK, installs beside dev/production
npx eas-cli@latest build --profile production --platform android --local   # AAB for Play
```

`versionCode` is managed remotely by EAS (`appVersionSource: remote`); all three profiles auto-increment so a newer preview APK upgrades in place.
Install a preview APK: `adb install -r <file>.apk`. Build output goes to the path EAS prints; delete it afterwards (disk).

## 3. Over-the-air updates (JS-only)

Channels equal the build profile (`development`, `preview`, `production`); the runtime version is the **fingerprint** of the native project, so an update only
reaches binaries with identical native code. The app checks on load, downloads in the background and applies on the **next** launch.

```sh
npx expo-updates fingerprint:generate --platform android     # compare with the last build's fingerprint (or: npx eas-cli fingerprint:compare)
npx eas-cli@latest update --channel preview --message "<summary>"
npx eas-cli@latest update --channel production --message "<summary>"
```

- **Only for JS/asset-only changes.** A new/updated native module, plugin, permission or `app.config.ts` native field changes the fingerprint: ship a store build instead.
- **Never OTA anything touching purchases or ads** (ADR MA-0007).
- Verify on device: Account -> About shows the update id and channel; it changes on the second launch after publishing.
- Rollback: `npx eas-cli@latest update:rollback-to-embedded --channel production` (back to the binary's bundle) or
  `npx eas-cli@latest update:republish --group <update-group-id> --channel production` (re-publish an earlier group). Check `eas update --help` if a name has moved.

## 4. Submit

```sh
npx eas-cli@latest submit --profile production --platform android --latest
```

Goes to the **internal** testing track as a **draft** (`eas.json` `submit.production.android`). Promotion beyond internal is MA28.

## 5. Release checklist

1. `npm run gates` green (includes `node scripts/gen-icons.mjs --check`).
2. Changelog notes (MA28).
3. Version: `npm run version:bump -- patch|minor|major` (edits `package.json`, lockfile, `APP_VERSION` in `app.config.ts`; `versionCode` is EAS's).
4. Production build (section 2). 5. Submit to internal (section 4).
5. Install from the internal track and run `maestro/flows/smoke.yaml` (see `maestro/README.md`).
6. Promote (MA28). 8. Remember the OTA policy (section 3).

Icons: `node scripts/gen-icons.mjs` regenerates `assets/*` from the aperture vector data in `scripts/aperture.mjs` (only needed if the mark changes).

## 6. Data hygiene

Maestro and device checks use only the dedicated **Pro test account**, never Mitch's. Flows delete what they create; verify the test account's History is empty of run leftovers.
Never run `clearState` flows on a phone with a session you want to keep.

## 7. Troubleshooting

- Google sign-in `DEVELOPER_ERROR`: the build's keystore SHA-1/SHA-256 is missing from that variant's Firebase Android app (section 1.3), or `google-services.json` was not re-downloaded.
- OTA not arriving: fingerprint mismatch (native change since the build), wrong channel, or only one launch since publishing (it applies on the second).
- Android manifest merge fails on `default_notification_channel_id`: the FCM channel is declared only in `firebase.json`; never add `defaultChannel` to the `expo-notifications` plugin.
- Preview Crashlytics check: preview build -> Account -> About -> tap the version row 7 times -> "Send test crash"; reopen the app; the crash shows in the Firebase console within a few minutes.
