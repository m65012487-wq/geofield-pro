import ExpoModulesCore
import CoreBluetooth

/**
 * GNSS-приёмник на iOS. Классический Bluetooth SPP iPhone сторонним приложениям не даёт,
 * поэтому здесь BLE: поиск устройств рядом, подписка на все характеристики с notify,
 * поток строк NMEA в JS — тот же интерфейс, что у модуля Android.
 */
public class GnssBtModule: Module {
  private lazy var link = BleLink(emit: { [weak self] name, body in self?.sendEvent(name, body) })

  public func definition() -> ModuleDefinition {
    Name("GnssBt")
    Events("onLine", "onState", "onStats")

    Function("isEnabled") { () -> Bool in self.link.isPoweredOn() }

    Function("hasPermission") { () -> Bool in BleLink.authorized() }

    AsyncFunction("requestPermission") { (promise: Promise) in
      self.link.requestPermission { promise.resolve($0) }
    }

    // на iOS «сопряжённых» нет — список найденных поблизости BLE-устройств (поиск идёт ~20 с)
    Function("bondedDevices") { () -> [[String: String]] in self.link.devices() }

    Function("isConnected") { () -> Bool in self.link.isConnected() }

    AsyncFunction("connect") { (address: String, promise: Promise) in
      self.link.connect(address) { ok, err in
        if let err = err { promise.reject("BT_CONNECT", err) } else { promise.resolve(ok) }
      }
    }

    Function("disconnect") { self.link.disconnect() }

    AsyncFunction("write") { (text: String, promise: Promise) in
      self.link.write(text) { err in
        if let err = err { promise.reject("BT_WRITE", err) } else { promise.resolve(true) }
      }
    }

    OnDestroy { self.link.disconnect() }
  }
}

final class BleLink: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  typealias Emit = (String, [String: Any?]) -> Void

  // служебные сервисы GAP, GATT, сведения об устройстве, батарея — не канал данных
  private static let skip: Set<CBUUID> = [CBUUID(string: "1800"), CBUUID(string: "1801"), CBUUID(string: "180A"), CBUUID(string: "180F")]

  private let emit: Emit
  private let queue = DispatchQueue(label: "gnss-ble")
  private var central: CBCentralManager?
  private var found: [UUID: (CBPeripheral, String)] = [:]
  private var order: [UUID] = []
  private var scanGen = 0

  private var peripheral: CBPeripheral?
  private var writeChar: CBCharacteristic?
  private var writeFromDataService = false
  private var servicesLeft = 0
  private var notifyRequested = 0
  private var ready = false
  private var pendingConnect: ((Bool, String?) -> Void)?
  private var pendingPermission: [(Bool) -> Void] = []

  private var line = [UInt8]()
  private var total = 0
  private var tail = [UInt8]()
  private var lastStat = Date.distantPast

  init(emit: @escaping Emit) {
    self.emit = emit
    super.init()
  }

  static func authorized() -> Bool {
    if #available(iOS 13.1, *) { return CBManager.authorization == .allowedAlways }
    return true
  }

  /// Только из queue. Первое создание показывает системный запрос разрешения.
  private func ensureCentral() -> CBCentralManager {
    if let c = central { return c }
    let c = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: true])
    central = c
    return c
  }

  func isPoweredOn() -> Bool {
    queue.sync { () -> Bool in
      let s = ensureCentral().state
      return s == .poweredOn || s == .unknown
    }
  }

  func requestPermission(_ done: @escaping (Bool) -> Void) {
    queue.async {
      let c = self.ensureCentral()
      if c.state != .unknown && c.state != .resetting { done(BleLink.authorized()); return }
      self.pendingPermission.append(done)
    }
  }

  func devices() -> [[String: String]] {
    queue.sync { () -> [[String: String]] in
      let c = ensureCentral()
      if c.state == .poweredOn && peripheral == nil && !c.isScanning { startScan(c) }
      return order.compactMap { id in found[id].map { ["name": $0.1, "address": id.uuidString] } }
    }
  }

  func isConnected() -> Bool { queue.sync { ready && peripheral != nil } }

  func connect(_ address: String, _ done: @escaping (Bool, String?) -> Void) {
    queue.async {
      let c = self.ensureCentral()
      guard c.state == .poweredOn else { done(false, "Bluetooth выключен или нет разрешения"); return }
      guard let id = UUID(uuidString: address) else { done(false, "Неверный адрес устройства"); return }
      self.drop(cancel: true)
      guard let p = self.found[id]?.0 ?? c.retrievePeripherals(withIdentifiers: [id]).first else {
        done(false, "Устройство не найдено — обновите список"); return
      }
      c.stopScan()
      self.peripheral = p
      p.delegate = self
      self.pendingConnect = done
      self.emitState("connecting", "Подключение к \(self.nameOf(p))…")
      c.connect(p, options: nil)
      self.queue.asyncAfter(deadline: .now() + 15) { [weak self] in
        guard let self = self, self.peripheral === p, !self.ready else { return }
        self.fail("Не подключился за 15 с")
      }
    }
  }

  func disconnect() {
    queue.async {
      self.drop(cancel: true)
      self.emitState("disconnected", "Отключено")
    }
  }

  func write(_ text: String, _ done: @escaping (String?) -> Void) {
    queue.async {
      guard let p = self.peripheral, self.ready, let ch = self.writeChar else { done("нет соединения или канала записи"); return }
      guard let data = text.data(using: .ascii) else { done("команда не в ASCII"); return }
      let type: CBCharacteristicWriteType = ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
      let chunk = max(20, p.maximumWriteValueLength(for: type))
      var i = 0
      while i < data.count {
        p.writeValue(data.subdata(in: i..<min(i + chunk, data.count)), for: ch, type: type)
        i += chunk
      }
      done(nil)
    }
  }

  // MARK: - внутреннее (всё на queue)

  private func startScan(_ c: CBCentralManager) {
    scanGen += 1
    let gen = scanGen
    c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    queue.asyncAfter(deadline: .now() + 20) { [weak self] in
      guard let self = self, self.scanGen == gen, let c = self.central, c.isScanning else { return }
      c.stopScan()
    }
  }

  private func nameOf(_ p: CBPeripheral) -> String { found[p.identifier]?.1 ?? p.name ?? p.identifier.uuidString }

  private func emitState(_ state: String, _ message: String) {
    emit("onState", ["state": state, "message": message])
  }

  private func drop(cancel: Bool) {
    let p = peripheral
    peripheral = nil
    writeChar = nil
    writeFromDataService = false
    servicesLeft = 0
    notifyRequested = 0
    ready = false
    line.removeAll()
    if cancel, let p = p { central?.cancelPeripheralConnection(p) }
  }

  private func fail(_ message: String) {
    drop(cancel: true)
    emitState("error", message)
    pendingConnect?(false, message)
    pendingConnect = nil
  }

  private func feed(_ data: Data) {
    total += data.count
    for b in data {
      if b == 10 || b == 13 {
        if !line.isEmpty, let s = String(bytes: line, encoding: .ascii), !s.trimmingCharacters(in: .whitespaces).isEmpty {
          emit("onLine", ["line": s])
        }
        line.removeAll(keepingCapacity: true)
      } else if b >= 32 && b <= 126 && line.count < 512 {
        line.append(b)
      }
    }
    tail.append(contentsOf: data)
    if tail.count > 48 { tail.removeFirst(tail.count - 48) }
    let now = Date()
    if now.timeIntervalSince(lastStat) > 1 {
      lastStat = now
      emit("onStats", ["bytes": Double(total), "hex": tail.map { String(format: "%02X", $0) }.joined(separator: " ")])
    }
  }

  // MARK: - CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state != .unknown && central.state != .resetting {
      let ok = BleLink.authorized()
      let waiting = pendingPermission
      pendingPermission.removeAll()
      waiting.forEach { $0(ok) }
    }
    if central.state == .poweredOn {
      if peripheral == nil { startScan(central) }
    } else if peripheral != nil {
      fail("Bluetooth выключен")
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name
    guard let n = name, !n.isEmpty else { return }
    if found[peripheral.identifier] == nil { order.append(peripheral.identifier) }
    found[peripheral.identifier] = (peripheral, n)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard peripheral === self.peripheral else { return }
    peripheral.discoverServices(nil)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard peripheral === self.peripheral else { return }
    fail("Не подключился: \(error?.localizedDescription ?? "отказ")")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard peripheral === self.peripheral else { return }
    fail("Приёмник закрыл соединение")
  }

  // MARK: - CBPeripheralDelegate

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard peripheral === self.peripheral else { return }
    let services = (peripheral.services ?? []).filter { !BleLink.skip.contains($0.uuid) }
    if services.isEmpty { fail("У устройства нет канала данных BLE"); return }
    servicesLeft = services.count
    services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard peripheral === self.peripheral else { return }
    let chars = service.characteristics ?? []
    let hasNotify = chars.contains { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
    for ch in chars {
      if ch.properties.contains(.notify) || ch.properties.contains(.indicate) {
        notifyRequested += 1
        peripheral.setNotifyValue(true, for: ch)
      }
      // команды пишем в канал того же сервиса, откуда идёт поток (как у UART-мостов)
      if ch.properties.contains(.write) || ch.properties.contains(.writeWithoutResponse) {
        if writeChar == nil || (hasNotify && !writeFromDataService) {
          writeChar = ch
          writeFromDataService = hasNotify
        }
      }
    }
    servicesLeft -= 1
    if servicesLeft == 0 && notifyRequested == 0 { fail("У устройства нет канала данных BLE") }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard peripheral === self.peripheral, error == nil, characteristic.isNotifying, !ready else { return }
    ready = true
    emitState("connected", nameOf(peripheral))
    pendingConnect?(true, nil)
    pendingConnect = nil
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard peripheral === self.peripheral, error == nil, let data = characteristic.value else { return }
    feed(data)
  }
}
