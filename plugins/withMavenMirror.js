// Maven Central отдаёт react-android/hermes-android редиректом на repo.reactnative.dev, который
// отсюда качается со скоростью ~200 Б/с, и Gradle падает по таймауту. Зеркало Central от Google
// отдаёт те же файлы быстро — ставим его первым в репозиториях всех модулей.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MIRROR = "maven { url 'https://maven-central.storage-download.googleapis.com/maven2' }";

module.exports = function withMavenMirror(config) {
  return withProjectBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('maven-central.storage-download.googleapis.com')) {
      src = src.replace(/repositories\s*\{/g, (m) => `${m}\n    ${MIRROR}`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
