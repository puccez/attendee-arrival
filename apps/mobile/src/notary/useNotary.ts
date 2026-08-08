import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";

import {
  WemeetBeacon,
  type NotaryStatePayload,
} from "../../modules/wemeet-beacon";
import { fetchEventSeed } from "../lib/api";
import { BEACON_UUID } from "../lib/config";
import { logDeviceEvent, readSetting, writeSetting } from "../wallet/wallet";
import {
  notaryAnnouncement,
  reconcileCharge,
  type NotaryCharge,
} from "./notary";

/**
 * Il driver della modalità notaio: l'anello fra la parte pura (notary.ts,
 * inchiodata dai test) e la radio vera (modulo nativo).
 *
 * Va montato alla radice dell'app, non nella schermata: su Android
 * l'emissione continua a schermo spento dentro il foreground service, e la
 * rotazione del codice ogni 30 s la guida QUESTO timer — se vivesse nella
 * schermata, chiuderla lascerebbe in onda un codice congelato, cioè
 * scaduto. Su iPhone è il sistema a fermare l'advertising fuori dal primo
 * piano: al rientro il listener su AppState rimette in onda la finestra
 * corrente.
 */

/** Le impostazioni dove vive l'incarico (e SOLO lì: mai nel borsellino). */
export const SETTING_NOTARY_EVENT = "notary-event";
export const SETTING_NOTARY_SEED = "notary-seed";

export interface NotaryHandle {
  /** Il modulo nativo sa emettere su questa build? */
  available: boolean;
  /** L'incarico è attivo: il telefono sta giocando il ruolo del notaio. */
  active: boolean;
  /** Il Codice Rotante attualmente in onda (quello della console). */
  code: string | null;
  /** La radio conferma che l'annuncio è in onda. */
  emitting: boolean;
  bluetooth: string | null;
  error: string | null;
  busy: boolean;
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
}

async function clearStoredCharge(): Promise<void> {
  await writeSetting(SETTING_NOTARY_EVENT, "");
  await writeSetting(SETTING_NOTARY_SEED, "");
}

/**
 * L'igiene del seme, applicata alla persistenza: rilegge l'incarico salvato
 * e lo butta se non vale più per l'evento corrente.
 */
async function loadStoredCharge(
  currentEventId: string | null,
): Promise<NotaryCharge | null> {
  const stored = {
    eventId: (await readSetting(SETTING_NOTARY_EVENT)) ?? "",
    seed: (await readSetting(SETTING_NOTARY_SEED)) ?? "",
  };
  const charge = reconcileCharge(stored, currentEventId);
  if (!charge && stored.seed) await clearStoredCharge();
  return charge;
}

export function useNotary(
  eventId: string | null,
  eventName: string | null,
): NotaryHandle {
  const [charge, setCharge] = useState<NotaryCharge | null>(null);
  const [radio, setRadio] = useState<NotaryStatePayload | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rotationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* L'incarico sopravvive al riavvio dell'app (rete morta compresa),
     ma solo per il suo evento: cambiare evento lo revoca. */
  useEffect(() => {
    void loadStoredCharge(eventId).then(setCharge);
  }, [eventId]);

  useEffect(() => {
    if (!WemeetBeacon) return;
    const subscription = WemeetBeacon.addListener(
      "onNotaryState",
      (payload: NotaryStatePayload) => {
        setRadio(payload);
        if (payload.error) setError(payload.error);
      },
    );
    return () => subscription.remove();
  }, []);

  /* Il giro di rotazione: metti in onda la finestra corrente, ripresentati
     alla prossima. Un fallimento non ferma il giro — un notaio con il
     Bluetooth spento per un minuto deve riprendere da solo. */
  useEffect(() => {
    if (!charge || !WemeetBeacon) return;
    let cancelled = false;

    const rotate = async () => {
      if (cancelled) return;
      const announcement = notaryAnnouncement(charge.seed, new Date());
      setCode(announcement.code);
      try {
        await WemeetBeacon!.startAdvertisingAsync(
          BEACON_UUID,
          announcement.major,
          announcement.minor,
          {
            title: "Modalità notaio attiva",
            body: eventName
              ? `${eventName} emette da questo telefono`
              : "L'evento emette da questo telefono",
          },
        );
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        await logDeviceEvent(
          charge.eventId,
          "notaio_errore",
          String(e).slice(0, 200),
        );
      }
      if (cancelled) return;
      // Un soffio dopo il confine: mai in onda la finestra vecchia.
      rotationTimer.current = setTimeout(
        () => void rotate(),
        announcement.rotateInMs + 50,
      );
    };

    void rotate();

    // iOS ferma l'advertising fuori dal primo piano e il timer con lui: al
    // rientro non si aspetta il resto della finestra, si riparte subito.
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (rotationTimer.current) clearTimeout(rotationTimer.current);
      void rotate();
    });

    return () => {
      cancelled = true;
      appState.remove();
      if (rotationTimer.current) clearTimeout(rotationTimer.current);
      WemeetBeacon?.stopAdvertisingAsync().catch(() => {});
    };
  }, [charge, eventName]);

  const activate = useCallback(async () => {
    if (!eventId) return;
    if (!WemeetBeacon) {
      setError("Questa build non ha il modulo radio: serve una dev build.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (Platform.OS === "android" && Number(Platform.Version) >= 31) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setError("Senza il permesso di emettere, il notaio resta muto.");
          return;
        }
      }
      // Il seme scende UNA volta: se l'incarico per questo evento c'è già,
      // si riparte da lì anche senza rete.
      let next = await loadStoredCharge(eventId);
      if (!next) {
        const { seed } = await fetchEventSeed(eventId);
        next = { eventId, seed };
        await writeSetting(SETTING_NOTARY_EVENT, eventId);
        await writeSetting(SETTING_NOTARY_SEED, seed);
      }
      await logDeviceEvent(eventId, "notaio_acceso");
      setCharge(next);
    } catch (e) {
      // Tre casi, tre voci: ApiError = il server ha risposto (e ha detto no);
      // TypeError = fetch non è partito, cioè rete davvero assente; tutto il
      // resto NON è rete (un inciampo del borsellino, per dire) e va mostrato
      // per quello che è — un «serve campo» bugiardo manda a caccia del WiFi
      // chi ha un problema diverso.
      setError(
        e instanceof Error && "status" in e
          ? e.message
          : e instanceof TypeError
            ? "Il seme non scende senza rete: serve campo, solo per questa volta."
            : `Il seme non è sceso: ${e instanceof Error ? e.message : String(e)}`,
      );
      await logDeviceEvent(
        eventId,
        "notaio_errore_seme",
        String(e).slice(0, 200),
      ).catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  const deactivate = useCallback(async () => {
    // Prima si tace, poi si dimentica: l'ordine è parte dell'igiene.
    await WemeetBeacon?.stopAdvertisingAsync().catch(() => {});
    await clearStoredCharge();
    if (eventId) await logDeviceEvent(eventId, "notaio_spento");
    setCharge(null);
    setCode(null);
    setRadio(null);
  }, [eventId]);

  return {
    available: WemeetBeacon != null,
    active: charge != null,
    code: charge ? code : null,
    emitting: radio?.advertising ?? false,
    bluetooth: radio?.bluetooth ?? null,
    error,
    busy,
    activate,
    deactivate,
  };
}
