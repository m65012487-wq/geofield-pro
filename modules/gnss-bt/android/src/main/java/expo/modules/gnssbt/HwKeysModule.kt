package expo.modules.gnssbt

import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Клавиши громкости (и «камера» пульта) как спуск съёмки (как в LandStar). Пока экран съёмки включил перехват,
 * нажатие уходит в JS событием onKey, а громкость не меняется; в остальное время клавиша обычная.
 */
class HwKeysModule : Module() {
  companion object {
    @Volatile private var instance: HwKeysModule? = null
    @Volatile private var enabled = false

    /** Вызывается из MainActivity.dispatchKeyEvent — его вставляет плагин plugins/withVolumeKey.js. */
    @JvmStatic
    fun onKey(event: KeyEvent): Boolean {
      // «громкость −» на телефоне; «громкость +» и «камера» шлют Bluetooth-пульты для селфи
      val key = when (event.keyCode) {
        KeyEvent.KEYCODE_VOLUME_DOWN -> "volumeDown"
        KeyEvent.KEYCODE_VOLUME_UP -> "volumeUp"
        KeyEvent.KEYCODE_CAMERA -> "camera"
        else -> return false
      }
      if (!enabled) return false
      val m = instance ?: return false
      // удержание даёт повторы — снимаем один раз на нажатие; отпускание тоже глотаем
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        m.sendEvent("onKey", mapOf("key" to key))
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
