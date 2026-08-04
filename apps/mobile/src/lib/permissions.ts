import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { PermissionsAndroid, Platform } from "react-native";

/**
 * I permessi del canale radio, chiesti nell'ordine che i sistemi accettano.
 *
 * Nessuno di questi è un requisito del check-in: la porta della copertura
 * non si chiude, si etichetta (vedi CONTEXT.md). Se l'attendee nega tutto,
 * resta il canale ottico (codice a mano) e la testimonianza umana dell'host.
 */

export interface PermissionReport {
  /** Ascolto radio possibile (BLUETOOTH_SCAN su Android 12+). */
  radio: boolean;
  /** Risveglio in prossimità ad app chiusa (posizione "sempre"). */
  wake: boolean;
  /** Notifica one-tap. */
  notifications: boolean;
}

export async function requestBeaconPermissions(): Promise<PermissionReport> {
  const report: PermissionReport = {
    radio: false,
    wake: false,
    notifications: false,
  };

  const notification = await Notifications.requestPermissionsAsync();
  report.notifications = notification.granted;

  if (Platform.OS === "android") {
    // Android 12+: la scansione BLE non richiede più la posizione, purché
    // si dichiari `neverForLocation` (lo fa il manifest del modulo).
    const wanted: string[] = [];
    if (Number(Platform.Version) >= 31) {
      wanted.push("android.permission.BLUETOOTH_SCAN");
    } else {
      wanted.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    }
    const granted = await PermissionsAndroid.requestMultiple(
      wanted as Parameters<typeof PermissionsAndroid.requestMultiple>[0],
    );
    report.radio = wanted.every((permission) => granted[permission] === "granted");
  }

  // La posizione serve solo al risveglio (geofence e, su iOS, region
  // monitoring). Non è mai una prova: sveglia l'app e innesca la notifica.
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (Platform.OS === "ios") {
    // Su iOS il canale radio PASSA da CoreLocation: senza questo permesso
    // l'iPhone non sente il beacon affatto.
    report.radio = foreground.granted;
  }
  if (foreground.granted) {
    const background = await Location.requestBackgroundPermissionsAsync();
    report.wake = background.granted;
  }

  return report;
}

export async function currentPermissions(): Promise<PermissionReport> {
  const notification = await Notifications.getPermissionsAsync();
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();

  let radio = foreground.granted;
  if (Platform.OS === "android") {
    radio =
      Number(Platform.Version) >= 31
        ? await PermissionsAndroid.check(
            "android.permission.BLUETOOTH_SCAN" as Parameters<
              typeof PermissionsAndroid.check
            >[0],
          )
        : foreground.granted;
  }

  return {
    radio,
    wake: background.granted,
    notifications: notification.granted,
  };
}
