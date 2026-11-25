/**
 * MA60 decision 5: the Gradle JVM args plugin. The transform runs on Expo's parsed
 * android/gradle.properties list (CNG: the file is generated, never committed).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { buildConfig } from '../../app.config';

type Prop = { type: 'property'; key: string; value: string } | { type: 'comment'; value: string };

const { setJvmArgs, jvmArgs } = require('../withGradleJvmArgs') as {
  setJvmArgs: (p: Prop[]) => Prop[];
  jvmArgs: (v: string | undefined) => string;
};

const WANT_HEAP = '-Xmx4096m';
const WANT_META = '-XX:MaxMetaspaceSize=1536m';

describe('withGradleJvmArgs', () => {
  it("replaces Expo's default heap and Metaspace, keeping the template's other flags", () => {
    const props: Prop[] = [
      { type: 'comment', value: ' Specifies the JVM arguments used for the daemon process.' },
      {
        type: 'property',
        key: 'org.gradle.jvmargs',
        value:
          '-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
      },
      { type: 'property', key: 'android.useAndroidX', value: 'true' },
    ];
    const out = setJvmArgs(props);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({
      type: 'property',
      key: 'org.gradle.jvmargs',
      value: `${WANT_HEAP} ${WANT_META} -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8`,
    });
    expect(out[2]).toEqual({ type: 'property', key: 'android.useAndroidX', value: 'true' });
  });

  it('adds the property when the template has none', () => {
    const out = setJvmArgs([{ type: 'property', key: 'android.useAndroidX', value: 'true' }]);
    expect(out.find((p) => p.type === 'property' && p.key === 'org.gradle.jvmargs')).toEqual({
      type: 'property',
      key: 'org.gradle.jvmargs',
      value: `${WANT_HEAP} ${WANT_META}`,
    });
  });

  it('is idempotent (a second prebuild pass changes nothing)', () => {
    const once = jvmArgs('-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8');
    expect(jvmArgs(once)).toBe(once);
    expect(once.match(/-Xmx/g)).toHaveLength(1);
    expect(once.match(/MaxMetaspaceSize/g)).toHaveLength(1);
  });

  it('is registered in app.config (with react-native-webgpu) in every variant', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const variant of ['development', 'preview', 'production']) {
      const plugins = buildConfig({ APP_VARIANT: variant }, () => false).plugins ?? [];
      expect(plugins).toContain('./plugins/withGradleJvmArgs');
      expect(plugins).toContain('react-native-webgpu');
    }
    jest.restoreAllMocks();
  });
});
