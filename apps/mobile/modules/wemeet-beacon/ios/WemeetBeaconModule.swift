import CoreBluetooth
import CoreLocation
import ExpoModulesCore
import UIKit

internal final class InvalidUuidException: GenericException<String> {
  override var reason: String {
    "UUID di prossimità non valido: \(param)"
  }
}

/**
 iOS non consegna gli annunci iBeacon a CoreBluetooth: li riserva a
 CoreLocation. Il canale radio su iPhone passa quindi da qui.

 - `startMonitoring` sulla region dell'UUID sveglia l'app all'ingresso e
   all'uscita, anche se è chiusa (serve l'autorizzazione "Sempre"). Il
 risveglio dà una manciata di secondi: abbastanza per fare ranging,
   raccogliere il codice corrente e accodarlo nel borsellino.
 - `startRangingBeacons` dà major/minor, cioè il Codice Rotante.

 L'UUID è l'identità su cui il sistema sveglia l'app: per questo non ruota.
 Ciò che ruota sta in major/minor.

 La modalità notaio percorre la strada inversa: `CBPeripheralManager` mette
 in onda lo stesso frame iBeacon del firmware (è CoreLocation a comporlo,
 via `CLBeaconRegion.peripheralData`). Vincolo di piattaforma non
 aggirabile: iOS ferma l'advertising iBeacon appena l'app lascia il primo
 piano — il limite si dichiara nell'interfaccia, non si nasconde. Finché la
 schermata del notaio è aperta teniamo lo schermo sveglio (idle timer
 disattivato).

 Precedente: ProxiMate (FirstLayer-SRL/ProxiMate-ibeacon), stessa struttura
 con restoration identifier per il background.
 */
public class WemeetBeaconModule: Module {
  private var manager: CLLocationManager?
  private var delegate: BeaconDelegate?
  private var rangedUuid: UUID?
  private var monitoredUuid: UUID?
  private var permissionContinuation: CheckedContinuation<[String: String], Never>?
  private var peripheral: CBPeripheralManager?
  private var peripheralDelegate: NotaryPeripheralDelegate?
  /** Ciò che deve stare in onda adesso: si (ri)parte da qui a ogni poweredOn. */
  private var onAir: [String: Any]?

  public func definition() -> ModuleDefinition {
    Name("WemeetBeacon")

    Events("onBeaconRanged", "onRegionEnter", "onRegionExit", "onNotaryState")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        let delegate = BeaconDelegate(module: self)
        let manager = CLLocationManager()
        manager.delegate = delegate
        // Il risveglio in background è il punto di tutta l'operazione.
        manager.pausesLocationUpdatesAutomatically = false
        self.delegate = delegate
        self.manager = manager
      }
    }

    Function("isSupported") { () -> Bool in
      CLLocationManager.isMonitoringAvailable(for: CLBeaconRegion.self)
    }

    AsyncFunction("requestPermissionsAsync") { () -> [String: String] in
      await withCheckedContinuation { continuation in
        DispatchQueue.main.async { [weak self] in
          guard let self, let manager = self.manager else {
            continuation.resume(returning: ["location": "denied", "bluetooth": "denied"])
            return
          }
          let status = manager.authorizationStatus
          if status == .notDetermined || status == .authorizedWhenInUse {
            // Prima "quando in uso", poi "sempre": è la sequenza che iOS
            // accetta. Senza "sempre" niente risveglio da app chiusa.
            self.permissionContinuation = continuation
            if status == .notDetermined {
              manager.requestWhenInUseAuthorization()
            } else {
              manager.requestAlwaysAuthorization()
            }
          } else {
            continuation.resume(returning: Self.describe(status))
          }
        }
      }
    }

    AsyncFunction("startRangingAsync") { (uuid: String) in
      guard let parsed = UUID(uuidString: uuid) else {
        throw InvalidUuidException(uuid)
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, let manager = self.manager else { return }
        self.rangedUuid = parsed
        manager.startRangingBeacons(satisfying: CLBeaconIdentityConstraint(uuid: parsed))
      }
    }

    AsyncFunction("stopRangingAsync") {
      DispatchQueue.main.async { [weak self] in
        guard let self, let manager = self.manager, let uuid = self.rangedUuid else { return }
        manager.stopRangingBeacons(satisfying: CLBeaconIdentityConstraint(uuid: uuid))
        self.rangedUuid = nil
      }
    }

    AsyncFunction("startMonitoringAsync") { (uuid: String, _: [String: Any]) in
      guard let parsed = UUID(uuidString: uuid) else {
        throw InvalidUuidException(uuid)
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, let manager = self.manager else { return }
        let region = CLBeaconRegion(uuid: parsed, identifier: "wemeet-notaio")
        region.notifyOnEntry = true
        region.notifyOnExit = true
        // Rivaluta lo stato quando l'utente accende lo schermo: recupera
        // gli ingressi che il sistema ha coalizzato.
        region.notifyEntryStateOnDisplay = true
        self.monitoredUuid = parsed
        manager.startMonitoring(for: region)
        manager.requestState(for: region)
      }
    }

    AsyncFunction("stopMonitoringAsync") {
      DispatchQueue.main.async { [weak self] in
        guard let self, let manager = self.manager, let uuid = self.monitoredUuid else { return }
        manager.stopMonitoring(for: CLBeaconRegion(uuid: uuid, identifier: "wemeet-notaio"))
        self.monitoredUuid = nil
      }
    }

    // Su iOS il risveglio consegna gli eventi direttamente: niente coda.
    AsyncFunction("drainBackgroundSightingsAsync") { () -> [[String: Any]] in
      []
    }

    // Modalità notaio: mette in onda il frame dell'evento. Richiamarla con
    // major/minor nuovi È la rotazione del codice — il driver JS la invoca
    // a ogni finestra da 30 s. Le opzioni (titolo/corpo della notifica del
    // servizio) servono solo ad Android: qui si ignorano.
    AsyncFunction("startAdvertisingAsync") { (uuid: String, major: Int, minor: Int, _: [String: Any]) in
      guard let parsed = UUID(uuidString: uuid) else {
        throw InvalidUuidException(uuid)
      }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if self.peripheral == nil {
          let delegate = NotaryPeripheralDelegate(module: self)
          self.peripheralDelegate = delegate
          self.peripheral = CBPeripheralManager(delegate: delegate, queue: .main)
        }
        // Il frame lo compone CoreLocation: stessi byte del firmware,
        // stessa potenza calibrata dichiarata (-59 dBm a 1 m).
        let region = CLBeaconRegion(
          uuid: parsed,
          major: CLBeaconMajorValue(major),
          minor: CLBeaconMinorValue(minor),
          identifier: "wemeet-notaio-emissione"
        )
        let data = region.peripheralData(withMeasuredPower: NSNumber(value: -59))
        self.onAir = (data as NSDictionary) as? [String: Any]
        // Lo schermo resta acceso: su iPhone l'emissione vive solo in
        // foreground, e lo standby automatico la ucciderebbe in silenzio.
        UIApplication.shared.isIdleTimerDisabled = true
        self.flushAdvertising()
      }
    }

    AsyncFunction("stopAdvertisingAsync") {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.onAir = nil
        self.peripheral?.stopAdvertising()
        UIApplication.shared.isIdleTimerDisabled = false
        self.emitNotaryState()
      }
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if let manager = self.manager, let uuid = self.rangedUuid {
          manager.stopRangingBeacons(satisfying: CLBeaconIdentityConstraint(uuid: uuid))
        }
        if self.onAir != nil {
          self.peripheral?.stopAdvertising()
          UIApplication.shared.isIdleTimerDisabled = false
        }
      }
    }
  }

  /* ------------------------------------------------------ emissione */

  /** (Ri)mette in onda `onAir`, se la radio è accesa. */
  fileprivate func flushAdvertising() {
    guard let peripheral, peripheral.state == .poweredOn else {
      emitNotaryState()
      return
    }
    if peripheral.isAdvertising {
      peripheral.stopAdvertising()
    }
    if let onAir {
      peripheral.startAdvertising(onAir)
    }
  }

  fileprivate func emitNotaryState(error: String? = nil) {
    var payload: [String: Any] = [
      "advertising": peripheral?.isAdvertising ?? false,
      "bluetooth": Self.describeBluetooth(peripheral?.state),
    ]
    if let error { payload["error"] = error }
    sendEvent("onNotaryState", payload)
  }

  private static func describeBluetooth(_ state: CBManagerState?) -> String {
    switch state {
    case .poweredOn: return "acceso"
    case .poweredOff: return "spento"
    case .unauthorized: return "negato"
    case .unsupported: return "non supportato"
    default: return "in avvio"
    }
  }

  fileprivate func emitRanged(_ beacons: [CLBeacon]) {
    let now = Date().timeIntervalSince1970 * 1000
    let payload = beacons.map { beacon -> [String: Any] in
      [
        "uuid": beacon.uuid.uuidString,
        "major": beacon.major.intValue,
        "minor": beacon.minor.intValue,
        "rssi": beacon.rssi,
        "at": now,
      ]
    }
    sendEvent("onBeaconRanged", ["beacons": payload])
  }

  fileprivate func emitRegion(_ name: String, _ region: CLRegion) {
    let uuid = (region as? CLBeaconRegion)?.uuid.uuidString ?? region.identifier
    sendEvent(name, ["uuid": uuid])
  }

  fileprivate func resolvePermission(_ status: CLAuthorizationStatus) {
    guard let continuation = permissionContinuation else { return }
    // "Quando in uso" appena concesso: chiedi subito "sempre".
    if status == .authorizedWhenInUse {
      manager?.requestAlwaysAuthorization()
      return
    }
    if status == .notDetermined { return }
    permissionContinuation = nil
    continuation.resume(returning: Self.describe(status))
  }

  fileprivate static func describe(_ status: CLAuthorizationStatus) -> [String: String] {
    let location: String
    switch status {
    case .authorizedAlways: location = "granted"
    case .authorizedWhenInUse: location = "whenInUse"
    case .denied, .restricted: location = "denied"
    default: location = "undetermined"
    }
    // Su iOS il canale radio passa da CoreLocation: il permesso Bluetooth
    // separato serve solo se si emette, e l'app attendee non emette.
    return ["location": location, "bluetooth": "notRequired"]
  }
}

private class BeaconDelegate: NSObject, CLLocationManagerDelegate {
  private weak var module: WemeetBeaconModule?

  init(module: WemeetBeaconModule) {
    self.module = module
  }

  func locationManager(
    _ manager: CLLocationManager,
    didRange beacons: [CLBeacon],
    satisfying constraint: CLBeaconIdentityConstraint
  ) {
    guard !beacons.isEmpty else { return }
    module?.emitRanged(beacons)
  }

  func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    module?.emitRegion("onRegionEnter", region)
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    module?.emitRegion("onRegionExit", region)
  }

  func locationManager(
    _ manager: CLLocationManager,
    didDetermineState state: CLRegionState,
    for region: CLRegion
  ) {
    // Ingresso già in corso quando l'app parte: vale come arrivo.
    if state == .inside {
      module?.emitRegion("onRegionEnter", region)
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    module?.resolvePermission(manager.authorizationStatus)
  }
}

/**
 Il lato radio della modalità notaio. Un notaio morto dev'essere rumoroso:
 ogni cambiamento — radio accesa, spenta, permesso negato, annuncio partito
 o fallito — risale al JS come `onNotaryState`, e la schermata lo mostra.
 */
private class NotaryPeripheralDelegate: NSObject, CBPeripheralManagerDelegate {
  private weak var module: WemeetBeaconModule?

  init(module: WemeetBeaconModule) {
    self.module = module
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    // La radio è (ri)diventata utilizzabile: quel che doveva stare in onda
    // ci torna da solo, senza aspettare la prossima rotazione.
    module?.flushAdvertising()
  }

  func peripheralManagerDidStartAdvertising(
    _ peripheral: CBPeripheralManager,
    error: Error?
  ) {
    module?.emitNotaryState(error: error?.localizedDescription)
  }
}
