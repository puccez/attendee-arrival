// NativeModule serve come valore (clausola `extends`), non solo come tipo.
import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

/**
 * wemeet-beacon — l'orecchio radio dell'app.
 *
 * Due implementazioni native dietro una sola porta, perché le due
 * piattaforme espongono il canale radio in modo diverso:
 *
 * - **iOS: CoreLocation.** iOS non consegna gli annunci iBeacon a
 *   CoreBluetooth — li riserva a CoreLocation. Quindi qui si usano
 *   `startMonitoring` (risveglio dell'app all'ingresso nella region, anche
 *   se è chiusa) e `startRangingBeacons` (major/minor, cioè il Codice
 *   Rotante). È il motivo per cui l'UUID non può ruotare: è l'identità su
 *   cui il sistema sveglia l'app.
 * - **Android: BluetoothLeScanner.** Scansione diretta con filtro sui
 *   manufacturer data: l'app riceve i byte grezzi del frame e li interpreta
 *   con lo stesso parser condiviso (src/lib/ibeacon.ts). In background la
 *   scansione continua via PendingIntent: il sistema risveglia un receiver
 *   che accoda gli avvistamenti e li consegna all'app al risveglio.
 *
 * Il modulo è opzionale: se la dev build non lo contiene, l'app resta
 * utilizzabile (inserimento manuale del codice) invece di crashare.
 */

export interface NativeSighting {
  /** iOS (CoreLocation dà i campi già interpretati). */
  uuid?: string;
  major?: number;
  minor?: number;
  /** Android: i manufacturer data grezzi in base64, company id compreso. */
  manufacturerData?: string;
  /** Potenza ricevuta, indicatore di distanza — mai una prova. */
  rssi?: number;
  /** Millisecondi da epoch al momento dell'avvistamento. */
  at?: number;
}

/** Lo stato dell'emissione in modalità notaio: un notaio morto è rumoroso. */
export interface NotaryStatePayload {
  advertising: boolean;
  /** 'acceso' | 'spento' | 'negato' | 'non supportato' | 'in avvio' */
  bluetooth?: string;
  error?: string;
}

export type WemeetBeaconEvents = {
  onBeaconRanged: (payload: { beacons: NativeSighting[] }) => void;
  onRegionEnter: (payload: { uuid: string }) => void;
  onRegionExit: (payload: { uuid: string }) => void;
  onNotaryState: (payload: NotaryStatePayload) => void;
};

export interface BeaconPermissionStatus {
  /** 'granted' | 'whenInUse' | 'denied' | 'undetermined' */
  location: string;
  bluetooth: string;
}

declare class WemeetBeaconModuleType extends NativeModule<WemeetBeaconEvents> {
  /** Il canale radio è utilizzabile su questo device? */
  isSupported(): boolean;
  requestPermissionsAsync(): Promise<BeaconPermissionStatus>;
  /** Ascolto attivo: emette onBeaconRanged finché l'app è viva. */
  startRangingAsync(uuid: string): Promise<void>;
  stopRangingAsync(): Promise<void>;
  /**
   * Risveglio in prossimità. iOS: region monitoring (l'app si sveglia
   * anche da chiusa). Android: scansione via PendingIntent + notifica
   * nativa che apre `deepLink`.
   */
  startMonitoringAsync(uuid: string, options: {
    title: string;
    body: string;
    deepLink: string;
  }): Promise<void>;
  stopMonitoringAsync(): Promise<void>;
  /**
   * Avvistamenti accumulati mentre l'app non era viva (Android). Su iOS
   * ritorna sempre vuoto: lì il risveglio consegna direttamente gli eventi.
   */
  drainBackgroundSightingsAsync(): Promise<NativeSighting[]>;
  /**
   * Android: true se la notifica d'arrivo nativa (receiver, app chiusa) è
   * partita dall'ultima lettura — chi la consuma la piega nello stato di
   * transizione, così i risvegli successivi tacciono. iOS: sempre false.
   */
  consumeNativeArrivalAsync(): Promise<boolean>;
  /**
   * Lo specchio nativo della transizione d'arrivo (Android): «dentro»
   * silenzia la notifica del receiver — l'annuncio c'è già stato, da
   * qualunque strada — «fuori» la riarma per il prossimo rientro vero.
   * iOS: no-op.
   */
  syncArrivalStateAsync(inside: boolean): Promise<void>;
  /**
   * Modalità notaio: mette in onda il frame iBeacon dell'evento, identico
   * a quello dell'ESP32. Richiamarla con major/minor nuovi È la rotazione
   * del codice (la guida il driver JS, src/notary). Android emette dentro
   * un foreground service e continua a schermo spento — `options` è il
   * testo della sua notifica persistente; iOS emette solo in foreground
   * (vincolo di piattaforma) e le opzioni le ignora.
   */
  startAdvertisingAsync(
    uuid: string,
    major: number,
    minor: number,
    options: { title: string; body: string },
  ): Promise<void>;
  stopAdvertisingAsync(): Promise<void>;
}

export const WemeetBeacon =
  requireOptionalNativeModule<WemeetBeaconModuleType>("WemeetBeacon");

export const isBeaconModuleAvailable = WemeetBeacon != null;
