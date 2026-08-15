const { withGradleProperties } = require('expo/config-plugins');

/**
 * Raise the Gradle JVM's heap and metaspace ceilings.
 *
 * The template ships `-Xmx2048m -XX:MaxMetaspaceSize=512m`, and this app does
 * not fit in it: the release build loads every Expo module's annotation
 * processors and Kotlin compiler in one JVM, exhausts metaspace after the JS
 * bundle is already written, and fails ~12 minutes in with a one-word error
 * ("Metaspace") that names no cause. Raising the ceiling is the whole fix.
 *
 * A config plugin rather than an edit to `android/gradle.properties`, because
 * that file is generated — `expo prebuild --clean` rewrites it from the
 * template and the edit disappears, which is the failure this exists to stop.
 * `expo-build-properties` looks like the right home and is not: it covers SDK
 * versions, Kotlin, Proguard, packaging and maven repos, and has no way to set
 * a gradle property. `withGradleProperties` is the sanctioned hook and ships
 * inside `expo`, so this costs no dependency.
 *
 * ponytail: values are fixed rather than configurable — one app, one build
 * machine shape. Take a `{ jvmargs }` prop if CI ever needs a different one.
 */
const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=2048m';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    // modResults is the parsed file: a flat list of property/comment/empty
    // nodes. Replace the key in place if the template already set it, so the
    // file keeps its ordering and we never end up with two of them.
    const existing = config.modResults.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      config.modResults.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: JVM_ARGS,
      });
    }
    return config;
  });
};
