package expo.modules.gnssbt

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * GNSS-приёмник по Bluetooth SPP: подключение к сопряжённому устройству, поток строк NMEA в JS,
 * отправка команд приёмнику. Одно соединение на приложение.
 */
@SuppressLint("MissingPermission")
class GnssBtModule : Module() {
  private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

  @Volatile private var socket: BluetoothSocket? = null
  @Volatile private var reader: Thread? = null
  @Volatile private var generation = 0

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("нет контекста")

  private fun adapter(): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun hasPermission(): Boolean =
    Build.VERSION.SDK_INT < 31 ||
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  override fun definition() = ModuleDefinition {
    Name("GnssBt")
    Events("onLine", "onState", "onStats")

    Function("isEnabled") { adapter()?.isEnabled == true }

    Function("hasPermission") { hasPermission() }

    AsyncFunction("requestPermission") { promise: Promise ->
      if (hasPermission()) { promise.resolve(true); return@AsyncFunction }
      val activity = appContext.currentActivity
      if (activity == null) { promise.resolve(false); return@AsyncFunction }
      activity.requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 4711)
      // ответ системы сюда не приходит — JS перепроверяет hasPermission() после возврата
      promise.resolve(false)
    }

    Function("bondedDevices") {
      val out = mutableListOf<Map<String, String>>()
      if (hasPermission()) {
        adapter()?.bondedDevices?.forEach { d: BluetoothDevice ->
          out.add(mapOf("name" to (d.name ?: d.address), "address" to d.address))
        }
      }
      out
    }

    Function("isConnected") { socket?.isConnected == true }

    AsyncFunction("connect") { address: String, promise: Promise ->
      val a = adapter()
      if (a == null || !a.isEnabled) { promise.reject("BT_OFF", "Bluetooth выключен", null); return@AsyncFunction }
      if (!hasPermission()) { promise.reject("BT_PERM", "Нет разрешения на Bluetooth", null); return@AsyncFunction }
      closeSocket()
      val gen = ++generation
      val dev = a.getRemoteDevice(address)
      Thread({
        // любой сбой потока — в событие, а не в падение приложения
        try { run(dev, gen, promise) } catch (e: Throwable) {
          sendEvent("onState", mapOf("state" to "error", "message" to "Ошибка: ${e.message}"))
          try { promise.reject("BT_FAIL", e.message ?: "ошибка", e) } catch (_: Throwable) {}
        }
      }, "gnss-bt").start()
    }

    Function("disconnect") {
      generation++
      closeSocket()
      sendEvent("onState", mapOf("state" to "disconnected", "message" to "Отключено"))
    }

    AsyncFunction("write") { text: String ->
      val s = socket ?: throw IllegalStateException("нет соединения")
      s.outputStream.write(text.toByteArray(StandardCharsets.US_ASCII))
      s.outputStream.flush()
    }

    OnDestroy {
      generation++
      closeSocket()
    }
  }

  private fun run(dev: BluetoothDevice, gen: Int, promise: Promise) {
    sendEvent("onState", mapOf("state" to "connecting", "message" to "Подключение к ${dev.name ?: dev.address}…"))
    // cancelDiscovery() на Android 12+ требует BLUETOOTH_SCAN — без него падает; поиск мы и не запускаем
    try { if (Build.VERSION.SDK_INT < 31) adapter()?.cancelDiscovery() } catch (_: Exception) {}
    var s: BluetoothSocket? = null
    try {
      s = dev.createRfcommSocketToServiceRecord(spp)
      s.connect()
    } catch (first: Exception) {
      // часть приёмников не объявляет SPP в SDP — тогда напрямую на канал 1
      try {
        s?.close()
        s = dev.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType).invoke(dev, 1) as BluetoothSocket
        s.connect()
      } catch (second: Exception) {
        try { s?.close() } catch (_: Exception) {}
        sendEvent("onState", mapOf("state" to "error", "message" to "Не подключился: ${first.message}"))
        promise.reject("BT_CONNECT", first.message ?: "не подключился", first)
        return
      }
    }
    if (gen != generation) { try { s?.close() } catch (_: Exception) {}; promise.resolve(false); return }
    socket = s
    promise.resolve(true)
    sendEvent("onState", mapOf("state" to "connected", "message" to (dev.name ?: dev.address)))
    try {
      // читаем байты, а не строки: приёмник может слать двоичный протокол без переводов строк,
      // тогда readLine() висел бы молча. Раз в секунду — счётчик байт и хвост в hex для диагностики.
      val input = s!!.inputStream
      val buf = ByteArray(4096)
      val line = StringBuilder()
      var total = 0L
      var lastStat = 0L
      var tail = ByteArray(0)
      while (gen == generation) {
        val n = input.read(buf)
        if (n < 0) break
        total += n
        for (i in 0 until n) {
          val c = (buf[i].toInt() and 0xFF)
          if (c == '\n'.code || c == '\r'.code) {
            if (line.isNotBlank()) sendEvent("onLine", mapOf("line" to line.toString()))
            line.setLength(0)
          } else if (c in 32..126) {
            if (line.length < 512) line.append(c.toChar())
          }
        }
        tail = (tail + buf.copyOf(n)).takeLast(48).toByteArray()
        val now = System.currentTimeMillis()
        if (now - lastStat > 1000) {
          lastStat = now
          sendEvent("onStats", mapOf("bytes" to total.toDouble(), "hex" to tail.joinToString(" ") { "%02X".format(it) }))
        }
      }
      if (gen == generation) sendEvent("onState", mapOf("state" to "error", "message" to "Приёмник закрыл соединение"))
    } catch (e: Exception) {
      if (gen == generation) sendEvent("onState", mapOf("state" to "error", "message" to "Связь потеряна: ${e.message}"))
    } finally {
      if (socket === s) socket = null
      try { s?.close() } catch (_: Exception) {}
    }
  }

  private fun closeSocket() {
    val s = socket
    socket = null
    try { s?.close() } catch (_: Exception) {}
  }
}
