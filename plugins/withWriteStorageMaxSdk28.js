// MA14: expo-media-library's config plugin adds WRITE_EXTERNAL_STORAGE uncapped and sets
// requestLegacyExternalStorage. Scoped storage (Android 10+) needs neither: MediaStore inserts need no
// permission, so the permission is capped to API <= 28 (Android 8-9, minSdk 26) and the legacy flag removed.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withWriteStorageMaxSdk28(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    for (const p of manifest['uses-permission'] ?? []) {
      if (p.$['android:name'] === 'android.permission.WRITE_EXTERNAL_STORAGE') {
        p.$['android:maxSdkVersion'] = '28';
      }
    }
    const app = manifest.application?.[0];
    if (app) delete app.$['android:requestLegacyExternalStorage'];
    return c;
  });
};
