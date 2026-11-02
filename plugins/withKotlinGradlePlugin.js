// @react-native-firebase 27 (Firebase BoM 35, firebase-auth 25) ships Kotlin 2.4 metadata, which RN
// 0.86's Kotlin 2.1 compiler cannot read. `android.kotlinVersion` (set via expo-build-properties,
// 2.3.20) only moves the stdlib and Expo's KSP: the root buildscript asks for
// `kotlin-gradle-plugin` without a version, so React Native's gradle plugin (2.1.20 in RN 0.86) wins
// and every module still compiles with Kotlin 2.1. This pins the root classpath to
// `android.kotlinVersion` so the compiler matches. Drop it once RN's default Kotlin reads the Firebase SDK's metadata.
const { withProjectBuildGradle } = require('expo/config-plugins');

const UNVERSIONED = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";
const PINNED =
  'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${findProperty(\'android.kotlinVersion\') ?: \'2.1.20\'}")';

module.exports = function withKotlinGradlePlugin(config) {
  return withProjectBuildGradle(config, (c) => {
    if (c.modResults.contents.includes(UNVERSIONED)) {
      c.modResults.contents = c.modResults.contents.replace(UNVERSIONED, PINNED);
    } else if (!c.modResults.contents.includes('kotlin-gradle-plugin:${')) {
      throw new Error('withKotlinGradlePlugin: root build.gradle kotlin-gradle-plugin line not found');
    }
    return c;
  });
};
