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
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | web OAuth client id (set in all three 2026-11-05)                           | same                                      |
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

**arm64-only test builds (MA60, disk):** an all-ABI local build (arm64, armeabi-v7a, x86, x86_64) grew the disk by more than 10 GB before it finished native code, with Skia 3 + WebGPU. Both test phones are arm64, so device-check builds use `--profile preview-arm64` / `--profile development-arm64`. They extend `preview` / `development` (same package id, channel, environment and `APP_VARIANT`, so `adb install -r` updates the installed app) and only add `android.gradleCommand` with `-PreactNativeArchitectures=arm64-v8a` (`:app:assembleRelease` / `:app:assembleDebug`). Their APK sizes are arm64-only and not comparable with all-ABI figures. MA60 (2026-11-24): `preview-arm64` APK 104,948,334 bytes (100.1 MiB), `development-arm64` APK 179,295,810 bytes (171.0 MiB); the production AAB size is not measured yet. **Store builds stay on `production`** (all ABIs, AAB).

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
- **`eas.json` is NOT part of the fingerprint** (since 2026-11-25, `.fingerprintignore`; Mitch's decision). It describes how a build is made (profiles, channels, the Gradle command, which CPU types), not what is in the app; anything in it that changes the app (`APP_VARIANT`) goes through `app.config.ts`, which stays in the fingerprint. Editing `eas.json` no longer changes any runtime version (verified with `npx expo-updates fingerprint:generate --platform android` before and after an edit). Before this, any edit to it changed every profile's runtime version: MA60's two arm64 profiles moved `d7809b12…` to `5440791f…`. Do not remove the ignore line; removing it changes every runtime version again.
- **Never OTA anything touching purchases or ads** (ADR MA-0007).
- Verify on device: Account -> About shows the update id and channel; it changes on the second launch after publishing.
- Rollback: `npx eas-cli@latest update:rollback-to-embedded --channel production` (back to the binary's bundle) or
  `npx eas-cli@latest update:republish --group <update-group-id> --channel production` (re-publish an earlier group). Check `eas update --help` if a name has moved.

### Fingerprints (Android, runtime version)

| Date       | Build                                                                                              | Fingerprint                                                                                                                                                         | Note                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-24 | MA60 (`react-native-skia` 3.10.2 + `react-native-webgpu` 0.22.0), branch `ma60-skia-3` @ `64644f3` | `5440791f0df4801235e886fdcfe2c869764e6a28`                                                                                                                          | A native change: no OTA published before it reaches this build. Accepted by the coordinator although it differs from the `d7809b12…` of the same native code, because the arm64 test profiles edited `eas.json` (see above); nothing was published to either hash.                                                   |
| 2026-11-25 | `main` with `.fingerprintignore` (`eas.json` excluded); native code unchanged from MA60            | preview `7e01e97b257a04636fd82233944e3c196a1c6734` · development `940d3aac1cc961d2a792ccc84559dd0bf01707a4` · production `35d99acdbdcf4827b0373c9b4c92837358f3fedc` | Computed locally, **no build made at this hash yet**. The builds on the test phones (S25 preview versionCode 14, S24U preview versionCode 15) are still `5440791f…`, so an OTA published from this commit on would not reach them: rebuild before testing an OTA. Nothing has been published to any of these hashes. |

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

## 6. Pinned native graphics packages (MA60)

`npx expo install --check` and `expo-doctor` do not track these, so a version catch-up (MA57-style) must **not** "fix" them:

| Package                    | Pin                            | Why                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-skia`        | **3.10.2** exact, no caret     | Skia 3 (Graphite on Vulkan / Metal) replaced `@shopify/react-native-skia` 2.6.2 in MA60. 3.10.2 is the version MA59/MA76 validated on the S25 (video path, memory gate) and Aperture was re-verified on. Never install `@shopify/react-native-skia` beside it (same native module).                                                            |
| `react-native-webgpu`      | **0.22.0** exact, no caret     | Darkroom/Motion's WebGPU layer and the GPU capability check (`src/gpu/capability.ts`). Validated with Skia 3.10.2 in MA59/MA76.                                                                                                                                                                                                                |
| `react-native-webgpu-dawn` | 158.0.0 (transitive, one copy) | Both packages above must link the **same** Dawn build or the native build fails with "Dawn version mismatch". Check `npm ls react-native-webgpu-dawn` shows one copy (`deduped`). Upgrade Skia and WebGPU **together**, only to a pair whose Dawn matches, and only with a re-run of the Aperture device check (and the MA59/MA76 video bars). |

- No `patch-package` patches are needed for either (MA59 recorded none); `patches/` holds only the gesture-handler backport.
- `plugins/withGradleJvmArgs.js` sets `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m`: a Skia 3 + WebGPU release build runs out of Metaspace in `lintVitalAnalyzeRelease` on Expo's default (MA76).
- The `react-native-webgpu` config plugin is in `app.config.ts` (minSdk 26, already ours; iOS simulator Metal validation off).
- Skia 3 declares Vulkan 1.1 as a **required** Android feature, so Play does not serve the app to devices without it; on such a device every canvas is blank (`Skia.gpu.isAvailable` false).
- Readback is async in Skia 3 (`readPixels`, `encodeToBytes`, `encodeToBase64`, `makeRasterImage` return promises): go through `src/photo/skia/readback.ts` `pixelBytes(await …)`, never `instanceof Uint8Array` on an un-awaited value. `SkPath` is immutable: build paths with `Skia.PathBuilder`.

## 7. Data hygiene

Maestro and device checks use only the dedicated **Pro test account**, never Mitch's. Flows delete what they create; verify the test account's History is empty of run leftovers.
Never run `clearState` flows on a phone with a session you want to keep.

## 8. Troubleshooting

- Google sign-in `DEVELOPER_ERROR`: the build's keystore SHA-1/SHA-256 is missing from that variant's Firebase Android app (section 1.3), or `google-services.json` was not re-downloaded.
- OTA not arriving: fingerprint mismatch (native change since the build), wrong channel, or only one launch since publishing (it applies on the second).
- Android manifest merge fails on `default_notification_channel_id`: the FCM channel is declared only in `firebase.json`; never add `defaultChannel` to the `expo-notifications` plugin.
- Preview Crashlytics check: preview build -> Account -> About -> tap the version row 7 times -> "Send test crash"; reopen the app; the crash shows in the Firebase console within a few minutes.
