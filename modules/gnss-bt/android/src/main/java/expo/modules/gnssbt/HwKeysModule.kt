package expo.modules.gnssbt

import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Клавиша «громкость −» как спуск съёмки (как в LandStar). Пока экран съёмки включил перехват,
 * нажатие уходит в JS событием onKey, а громкость не меняется; в остальное время клавиша обычная.
 */
class HwKeysModule : Module() {
  companion object {
    @Volatile private var instance: HwKeysModule? = null
    @Volatile private var enabled = false

    /** Вызывается из MainActivity.dispatchKeyEvent — его вставляет плагин plugins/withVolumeKey.js. */
    @JvmStatic
    fun onKey(event: KeyEvent): Boolean {
      if (!enabled || event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) return false
      val m = instance ?: return false
      // удержание даёт повторы — снимаем один раз на нажатие; отпускание тоже глотаем
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        m.sendEvent("onKey", mapOf("key" to "volumeDown"))
      }
      return true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("HwKeys")
    Events("onKey")

    OnCreate { instance = this@HwKeysModule }

    OnDestroy {
      if (instance === this@HwKeysModule) instance = null
      enabled = false
    }

    Function("setEnabled") { on: Boolean -> enabled = on }
  }
}
