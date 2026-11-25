// MA60 (ticket decision 5, from MA76): a release build with react-native-skia 3 + react-native-webgpu
// fails in `lintVitalAnalyzeRelease` with `java.lang.OutOfMemoryError: Metaspace` on Expo's default
// Gradle JVM args (512m Metaspace); `main` on Skia 2 already logged the Metaspace warning. This sets
// `org.gradle.jvmargs` in the generated android/gradle.properties (CNG: android/ is never committed).
// The template's other JVM flags (e.g. -XX:+HeapDumpOnOutOfMemoryError, -Dfile.encoding) are kept;
// only the heap and Metaspace sizes are replaced.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'org.gradle.jvmargs';
const HEAP = '-Xmx4096m';
const METASPACE = '-XX:MaxMetaspaceSize=1536m';

/** The jvmargs value with the heap and Metaspace set (other flags kept, in order). */
function jvmArgs(current) {
  const kept = String(current ?? '')
    .split(/\s+/)
    .filter((f) => f && !/^-Xmx/.test(f) && !/^-XX:MaxMetaspaceSize=/.test(f));
  return [HEAP, METASPACE, ...kept].join(' ');
}

/** Sets `org.gradle.jvmargs` on Expo's parsed gradle.properties list (adds it when absent). */
function setJvmArgs(props) {
  const entry = props.find((p) => p.type === 'property' && p.key === KEY);
  if (entry) entry.value = jvmArgs(entry.value);
  else props.push({ type: 'property', key: KEY, value: jvmArgs('') });
  return props;
}

function withGradleJvmArgs(config) {
  return withGradleProperties(config, (c) => {
    c.modResults = setJvmArgs(c.modResults);
    return c;
  });
}

module.exports = withGradleJvmArgs;
module.exports.setJvmArgs = setJvmArgs;
module.exports.jvmArgs = jvmArgs;
