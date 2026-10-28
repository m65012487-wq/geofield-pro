// Передаёт нажатия клавиш из MainActivity в модуль HwKeys (громкость − = снять точку).
// ReactActivity сам клавиши громкости в JS не отдаёт, поэтому перехват — в dispatchKeyEvent.
const { withMainActivity } = require('expo/config-plugins');

const HOOK = `
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (expo.modules.gnssbt.HwKeysModule.onKey(event)) return true
    return super.dispatchKeyEvent(event)
  }
`;

module.exports = function withVolumeKey(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('HwKeysModule.onKey')) {
      src = src.replace(/class MainActivity\s*:\s*ReactActivity\(\)\s*\{/, (m) => `${m}${HOOK}`);
      if (!src.includes('HwKeysModule.onKey')) throw new Error('withVolumeKey: не найден класс MainActivity');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
