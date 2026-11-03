# Maestro flows (MA25)

Agents never run these; Mitch does, on a phone, against a preview or internal-track build.

## Data hygiene (binding)

- Sign in **only** with the dedicated Pro test account. Never Mitch's account, never a personal one.
- Credentials are passed with `-e` and never written to a file: `MM_TEST_EMAIL`, `MM_TEST_PASSWORD`.
- Every flow that creates data deletes it: `history.yaml` deletes the converted result; `screenshots.yaml` deletes what it made.
  After a run the test account's History must hold nothing from the run (check it by eye).
- `sign-in-email.yaml` uses `clearState: true`: it wipes the **app's** local data on that device. Do not run it on a phone whose
  signed-in session you want to keep (the S24U dev/preview builds are separate apps from the release build, but check the app id).

## Setup

```sh
brew install maestro            # or the official installer
adb push maestro/fixtures/sample.jpg /sdcard/Pictures/mm-maestro-sample.jpg
```

The image is picked in the Android system Photo Picker, which has no app `testID`s: the flows tap the first grid item
(`point: 20%,30%`). Make `mm-maestro-sample.jpg` the newest photo (the push does that) and adjust the point if a device lays the grid out differently.

## App id (`MM_APP_ID`)

| Build | `MM_APP_ID` |
|---|---|
| production / internal track | `com.mediamanipulator.app` |
| preview | `com.mediamanipulator.app.preview` |
| development | `com.mediamanipulator.app.dev` |

## Run (from `mobile-app/`)

```sh
maestro test -e MM_APP_ID=com.mediamanipulator.app.preview \
  -e MM_TEST_EMAIL='<test account>' -e MM_TEST_PASSWORD='<password>' maestro/flows/smoke.yaml

# store screenshots (real screens; files land in ~/.maestro/tests/<timestamp>/)
maestro test -e MM_APP_ID=com.mediamanipulator.app \
  -e MM_TEST_EMAIL='<test account>' -e MM_TEST_PASSWORD='<password>' maestro/flows/screenshots.yaml
```

Each flow defaults `MM_APP_ID` to the production id (its `env:` header); `-e MM_APP_ID=...` overrides it.

`smoke.yaml` runs `sign-in-email` -> `convert-image` -> `save-result` -> `history` -> `sign-out`. The individual flows (except
sign-in) expect a signed-in session; `convert-image` leaves the result screen open for `save-result`, `history` then deletes it.
Selectors are `testID`s only (`tab-*`, `auth-*`, `tool-row-<id>`, `pick-media`, `convert-format-*`, `tool-start`, `result-body`,
`action-*`, `history-*`, `account-sign-out`, `sign-out-confirm`).
