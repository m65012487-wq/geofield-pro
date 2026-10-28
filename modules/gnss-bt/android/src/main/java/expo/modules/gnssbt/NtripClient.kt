package expo.modules.gnssbt

import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/** Ошибка, после которой переподключаться бессмысленно (неверный пароль, нет точки). */
class NtripFatal(message: String) : Exception(message)

/**
 * NTRIP-клиент (rev1): тянет RTCM с caster-а и отдаёт байты в [sink] (приёмник по Bluetooth).
 * Раз в 10 с шлёт на caster последнюю GGA ([gga]) — нужно для VRS. При обрыве переподключается через 5 с.
 * [emit] получает карту события onNtrip.
 */
class NtripClient(
  private val sink: (ByteArray, Int) -> Unit,
  private val gga: () -> String?,
  private val emit: (Map<String, Any>) -> Unit,
) {
  @Volatile private var generation = 0
  @Volatile private var current: Socket? = null

  // статистика (пишется только из потока клиента)
  @Volatile private var totalBytes = 0L
  @Volatile private var lastPacketAt = 0L

  fun start(host: String, port: Int, mount: String, user: String, pass: String) {
    stop(silent = true)
    val gen = ++generation
    totalBytes = 0
    lastPacketAt = 0
    Thread({
      try { loop(gen, host, port, mount, user, pass) } catch (e: Throwable) {
        if (gen == generation) publish("error", "Сбой NTRIP: ${e.message}", 0)
      }
    }, "ntrip").start()
  }

  fun stop(silent: Boolean = false) {
    val was = current
    generation++
    current = null
    try { was?.close() } catch (_: Exception) {}
    if (!silent) publish("stopped", "Отключено", 0)
  }

  private fun alive(gen: Int) = gen == generation

  private fun publish(state: String, message: String, rate: Long) {
    val last = if (lastPacketAt == 0L) -1.0 else (System.currentTimeMillis() - lastPacketAt).toDouble()
    try {
      emit(mapOf("state" to state, "message" to message, "bytes" to totalBytes.toDouble(), "rate" to rate.toDouble(), "lastMs" to last))
    } catch (_: Throwable) {}
  }

  private fun sleepWhile(gen: Int, ms: Long) {
    var left = ms
    while (left > 0 && alive(gen)) { Thread.sleep(200); left -= 200 }
  }

  private fun loop(gen: Int, host: String, port: Int, mount: String, user: String, pass: String) {
    while (alive(gen)) {
      var s: Socket? = null
      try {
        publish("connecting", "Подключение к $host:$port…", 0)
        s = Socket()
        current = s
        s.tcpNoDelay = true
        s.connect(InetSocketAddress(host, port), 10_000)
        s.soTimeout = 1000
        val out = s.getOutputStream()
        val inp = s.getInputStream()
        out.write(request("/$mount", host, port, user, pass).toByteArray(Charsets.ISO_8859_1))
        out.flush()
        readHeader(inp, gen, mount)
        if (!alive(gen)) return
        publish("connected", "Поправки идут", 0)
        stream(s, gen)
        if (alive(gen)) publish("error", "Связь с сервером потеряна, переподключение…", 0)
      } catch (e: NtripFatal) {
        if (alive(gen)) { publish("error", e.message ?: "Ошибка", 0); generation++ }
        return
      } catch (e: Throwable) {
        if (alive(gen)) publish("error", "Нет связи: ${e.message ?: e.javaClass.simpleName}. Повтор через 5 с…", 0)
      } finally {
        try { s?.close() } catch (_: Exception) {}
        if (current === s) current = null
      }
      sleepWhile(gen, 5000)
    }
  }

  /** Читает ответ caster-а: ICY 200 / HTTP 200 → ok, 401 → неверный пароль, SOURCETABLE → нет точки. */
  private fun readHeader(inp: InputStream, gen: Int, mount: String) {
    val deadline = System.currentTimeMillis() + 15_000
    val first = readLine(inp, gen, deadline)
    when {
      first.startsWith("ICY 200") -> return // дальше сразу поток RTCM
      first.contains(" 401") || first.contains("Unauthorized", true) -> throw NtripFatal("Неверный логин или пароль")
      first.startsWith("SOURCETABLE") -> throw NtripFatal("Нет такой точки подключения: $mount")
      Regex("HTTP/1\\.[01] 200.*").matches(first) -> {
        // заголовки до пустой строки; часть серверов на неверную точку отвечает 200 с таблицей источников
        while (alive(gen)) {
          val h = readLine(inp, gen, deadline)
          if (h.isEmpty()) break
          if (h.startsWith("Content-Type", true) && h.contains("sourcetable", true)) throw NtripFatal("Нет такой точки подключения: $mount")
        }
      }
      first.startsWith("HTTP/") -> throw NtripFatal("Сервер отказал: $first")
      else -> throw NtripFatal("Непонятный ответ сервера: ${first.take(60)}")
    }
  }

  private fun readLine(inp: InputStream, gen: Int, deadline: Long): String {
    val sb = StringBuilder()
    while (true) {
      if (!alive(gen)) return sb.toString()
      if (System.currentTimeMillis() > deadline) throw IOException("сервер не ответил")
      val c = try { inp.read() } catch (_: SocketTimeoutException) { continue }
      if (c < 0) throw IOException("сервер закрыл соединение")
      if (c == '\n'.code) return sb.toString().trimEnd('\r')
      if (sb.length < 1024) sb.append(c.toChar())
    }
  }

  private fun stream(s: Socket, gen: Int) {
    val inp = s.getInputStream()
    val out = s.getOutputStream()
    val buf = ByteArray(4096)
    var lastGgaAt = 0L
    var lastTick = System.currentTimeMillis()
    var tickBytes = totalBytes
    var lastData = System.currentTimeMillis()
    while (alive(gen)) {
      val now = System.currentTimeMillis()
      // GGA: сразу после подключения и затем раз в 10 с; пока приёмник её не выдал — пробуем на каждом круге
      if (now - lastGgaAt >= 10_000) {
        val g = gga()
        if (!g.isNullOrEmpty()) {
          out.write((g + "\r\n").toByteArray(Charsets.US_ASCII))
          out.flush()
          lastGgaAt = now
        }
      }
      try {
        val n = inp.read(buf)
        if (n < 0) return
        if (n > 0) {
          val t = System.currentTimeMillis()
          totalBytes += n
          lastPacketAt = t
          lastData = t
          try { sink(buf, n) } catch (_: Throwable) {} // приёмник отвалился — caster не рвём
        }
      } catch (_: SocketTimeoutException) {
        if (System.currentTimeMillis() - lastData > 30_000) return // тишина 30 с — считаем обрывом
      }
      val t = System.currentTimeMillis()
      if (t - lastTick >= 1000) {
        val rate = (totalBytes - tickBytes) * 1000 / (t - lastTick)
        tickBytes = totalBytes
        lastTick = t
        publish("connected", "Поправки идут", rate)
      }
    }
  }

  companion object {
    fun request(path: String, host: String, port: Int, user: String, pass: String): String {
      val sb = StringBuilder()
      sb.append("GET ").append(path).append(" HTTP/1.0\r\n")
      sb.append("Host: ").append(host).append(':').append(port).append("\r\n")
      sb.append("User-Agent: NTRIP GeoFieldPro/1.0\r\n")
      if (user.isNotEmpty() || pass.isNotEmpty()) {
        val b = Base64.encodeToString("$user:$pass".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        sb.append("Authorization: Basic ").append(b).append("\r\n")
      }
      sb.append("Ntrip-Version: Ntrip/1.0\r\n")
      sb.append("Connection: close\r\n\r\n")
      return sb.toString()
    }

    /** Список точек: GET / → строки STR;mount;id;format;…;lat;lon. */
    fun sourcetable(host: String, port: Int, user: String, pass: String): List<Map<String, Any>> {
      val s = Socket()
      try {
        s.connect(InetSocketAddress(host, port), 10_000)
        s.soTimeout = 10_000
        val os = s.getOutputStream()
        os.write(request("/", host, port, user, pass).toByteArray(Charsets.ISO_8859_1))
        os.flush()
        val bos = ByteArrayOutputStream()
        val inp = s.getInputStream()
        val buf = ByteArray(4096)
        val deadline = System.currentTimeMillis() + 20_000
        while (bos.size() < 2_000_000 && System.currentTimeMillis() < deadline) {
          val n = try { inp.read(buf) } catch (_: SocketTimeoutException) { break }
          if (n < 0) break
          bos.write(buf, 0, n)
          if (bos.toString("ISO-8859-1").contains("ENDSOURCETABLE")) break
        }
        val text = bos.toString("ISO-8859-1")
        val head = text.lineSequence().firstOrNull()?.trim() ?: ""
        if (head.contains(" 401") || head.contains("Unauthorized", true)) throw NtripFatal("Неверный логин или пароль")
        val out = mutableListOf<Map<String, Any>>()
        for (raw in text.lineSequence()) {
          val l = raw.trim()
          if (!l.startsWith("STR;")) continue
          val f = l.split(';')
          if (f.size < 4) continue
          val m = mutableMapOf<String, Any>("name" to f[1], "identifier" to f[2], "format" to f[3])
          val lat = f.getOrNull(9)?.toDoubleOrNull()
          val lon = f.getOrNull(10)?.toDoubleOrNull()
          if (lat != null && lon != null && (lat != 0.0 || lon != 0.0)) { m["lat"] = lat; m["lon"] = lon }
          out.add(m)
        }
        if (out.isEmpty() && !head.contains("200")) throw NtripFatal("Сервер ответил: ${head.take(60)}")
        return out
      } finally {
        try { s.close() } catch (_: Exception) {}
      }
    }
  }
}
