import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { WemeetBeacon } from "./modules/wemeet-beacon";
import { useBeaconChannel } from "./src/beacon/useBeaconChannel";
import { useNotary, type NotaryHandle } from "./src/notary/useNotary";
import {
  createEvent,
  fetchCheckIns,
  fetchCurrentCode,
  fetchEvent,
  fetchEvents,
  type ApiCheckIn,
  type ApiEvent,
} from "./src/lib/api";
import {
  opticalPayload,
  opticalVerdict,
  shouldConsiderScan,
} from "./src/lib/optical";
import {
  BEACON_UUID,
  EVENT_RETRY_MS,
  EVENT_UNREACHABLE_NOTE,
  FLUSH_INTERVAL_MS,
} from "./src/lib/config";
import { onArrivalTapped } from "./src/lib/notifications";
import {
  currentPermissions,
  requestBeaconPermissions,
  type PermissionReport,
} from "./src/lib/permissions";
import {
  SETTING_EVENT_ID,
  SETTING_EVENT_NAME,
  drainRadioBacklog,
  startGeofence,
  stopGeofence,
} from "./src/tasks";
import {
  collectCode,
  collectedCodeCount,
  flush,
  getAttendeeName,
  getDeviceId,
  lastCheckIn,
  markArrival,
  pendingCodeCount,
  readSetting,
  setAttendeeName,
  writeSetting,
} from "./src/wallet/wallet";

/**
 * App attendee — il lato telefono della testimonianza co-prodotta.
 *
 * Il beacon fa da notaio (ancora spazio-temporale), il telefono fa da
 * sensore: raccoglie i Codici Rotanti e ne fa eco al server. Non giudica
 * niente — la logica di fiducia vive tutta dietro la cucitura di verifica.
 *
 * Il linguaggio visivo è quello dell'app WeMeet (docs/design.md): sabbia,
 * card bianche senza bordo, pastiglie piene dove si tocca, corallo solo
 * dove si clicca. E la regola di §7: chi è a un aperitivo legge «Ci sei»,
 * non «provenance: machine» — il vocabolario della verifica sta chiuso in
 * «Dietro le quinte».
 */

/* Il blocco :root di docs/design.md §8, tradotto in costanti. */
const T = {
  brand: "#ff4758",
  brandTint: "rgba(255, 71, 88, 0.08)",
  surface: "#ffffff",
  surfaceSunken: "#f5f5f5",
  sandDeep: "#efe9e2",
  line: "#e5e5e5",
  ink: "#171717",
  inkStrong: "#262626",
  body: "#404040",
  muted: "#525252",
  faint: "#a3a3a3",
  tile: "#dfe8e9",
  ok: "#16a34a",
  warn: "#eab308",
  bad: "#dc2626",
  rCard: 16,
  rFull: 999,
};

/**
 * Gli inset di sistema arrivano dal provider, e servono soprattutto sotto:
 * su Android i pulsanti di navigazione COPRONO il fondo dello schermo, e
 * senza inset la barra d'azione ci finiva dietro. iOS andava bene per
 * fortuna, non per merito — ora il margine lo detta il dispositivo, non un
 * numero scelto guardando un solo telefono.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [event, setEvent] = useState<ApiEvent | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<PermissionReport | null>(null);
  const [checkIn, setCheckIn] = useState<ApiCheckIn | null>(null);
  const [collected, setCollected] = useState(0);
  const [pending, setPending] = useState(0);
  const [serverCode, setServerCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<"attendee" | "notaio">("attendee");

  const insets = useSafeAreaInsets();
  const beacon = useBeaconChannel(eventId);
  // Alla radice, non nella schermata: la rotazione del codice deve
  // sopravvivere alla navigazione (su Android emette a schermo spento).
  const notary = useNotary(eventId, event?.name ?? null);
  const deepLink = Linking.useURL();

  const refreshWallet = useCallback(async () => {
    if (!eventId) return;
    setCollected(await collectedCodeCount(eventId));
    setPending(await pendingCodeCount(eventId));
    setCheckIn(await lastCheckIn(eventId));
  }, [eventId]);

  /* ------------------------------------------------------------- avvio */

  useEffect(() => {
    void (async () => {
      setDeviceId(await getDeviceId());
      setName(await getAttendeeName());
      setEventId(await readSetting(SETTING_EVENT_ID));
      setPermissions(await currentPermissions());
    })();
  }, []);

  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    let retry: ReturnType<typeof setInterval> | null = null;

    // Il caricamento non si arrende: se l'evento non risponde, si ritenta
    // con calma finché la rete torna — e a quel punto il banner «non
    // raggiungibile» si toglie da solo (solo lui: il note è condiviso con
    // i messaggi del borsellino, che non vanno pestati).
    const load = async (): Promise<boolean> => {
      try {
        const loaded = await fetchEvent(eventId);
        if (!alive) return true;
        setEvent(loaded);
        setNote((current) => (current === EVENT_UNREACHABLE_NOTE ? null : current));
        await writeSetting(SETTING_EVENT_NAME, loaded.name);
        if (loaded.geofence) await startGeofence(loaded.geofence).catch(() => {});
        return true;
      } catch {
        if (alive) setNote(EVENT_UNREACHABLE_NOTE);
        return false;
      }
    };

    void (async () => {
      await refreshWallet();
      // Tutto ciò che il canale radio ha accumulato mentre l'app dormiva.
      if (await drainRadioBacklog(eventId)) await refreshWallet();
      if (await load()) return;
      retry = setInterval(() => {
        void load().then((ok) => {
          if (ok && retry) {
            clearInterval(retry);
            retry = null;
          }
        });
      }, EVENT_RETRY_MS);
    })();

    return () => {
      alive = false;
      if (retry) clearInterval(retry);
    };
  }, [eventId, refreshWallet]);

  /* La consegna periodica: il borsellino sale da solo, senza gesti. */
  useEffect(() => {
    if (!eventId || !deviceId) return;
    const timer = setInterval(() => {
      void flush(deviceId).then(refreshWallet).catch(() => {});
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [eventId, deviceId, refreshWallet]);

  /* Diagnostica della demo: il codice che il server si aspetta adesso. */
  useEffect(() => {
    if (!eventId) return;
    const tick = () =>
      fetchCurrentCode(eventId)
        .then(({ code }) => setServerCode(code))
        .catch(() => setServerCode(null));
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [eventId]);

  /* Il tap sulla notifica: arricchisce la qualità, mai la provenienza. */
  useEffect(() => {
    const subscription = onArrivalTapped((tappedEvent) => {
      void (async () => {
        await markArrival(tappedEvent, { confirmationTap: true });
        if (deviceId) await flush(deviceId).catch(() => {});
        await refreshWallet();
      })();
    });
    return () => subscription.remove();
  }, [deviceId, refreshWallet]);

  /* Notifica nativa Android → deep link wemeet://arrival */
  useEffect(() => {
    if (!deepLink || !eventId) return;
    if (!deepLink.includes("arrival")) return;
    void (async () => {
      await markArrival(eventId, { confirmationTap: true });
      if (deviceId) await flush(deviceId).catch(() => {});
      await refreshWallet();
    })();
  }, [deepLink, eventId, deviceId, refreshWallet]);

  useEffect(() => {
    void refreshWallet();
  }, [beacon.collectedNow, refreshWallet]);

  /* ------------------------------------------------------------- azioni */

  const grantPermissions = async () => {
    setPermissions(await requestBeaconPermissions());
    beacon.restart();
    await startMonitoring();
  };

  const startMonitoring = async () => {
    if (!WemeetBeacon) return;
    await WemeetBeacon.startMonitoringAsync(BEACON_UUID, {
      title: `Sei arrivato${event ? ` a ${event.name}` : ""}`,
      body: "Tocca per confermare la presenza",
      deepLink: Linking.createURL("arrival"),
    }).catch(() => {});
  };

  const deliverNow = async () => {
    if (!deviceId) return;
    setBusy(true);
    try {
      const report = await flush(deviceId);
      // In parole, non in etichette: «borsellino» vive nel dietro le quinte.
      setNote(
        report.delivered > 0
          ? "Fatto: la tua presenza è appena salita."
          : report.retryLater > 0
            ? "Niente rete per ora: appena torna, sale tutto da solo."
            : "Tutto già consegnato: non c'era niente in attesa.",
      );
      await refreshWallet();
    } finally {
      setBusy(false);
    }
  };

  const confirmPresence = async () => {
    if (!eventId) return;
    await markArrival(eventId, { confirmationTap: true });
    await deliverNow();
  };

  const forgetEvent = async () => {
    // L'igiene del seme: lasciare l'evento revoca anche l'incarico del
    // notaio — un telefono d'host non accumula segreti di eventi passati.
    await notary.deactivate();
    await stopGeofence();
    await WemeetBeacon?.stopMonitoringAsync().catch(() => {});
    await writeSetting(SETTING_EVENT_ID, "");
    setEventId(null);
    setEvent(null);
    setCheckIn(null);
    setView("attendee");
  };

  if (!eventId) {
    return (
      <EventPicker
        onPick={async (id, attendeeName) => {
          await writeSetting(SETTING_EVENT_ID, id.trim());
          await setAttendeeName(attendeeName.trim());
          setName(attendeeName.trim());
          setEventId(id.trim());
          await grantPermissions();
        }}
        // Il picker se ne va appena si entra: quello che ha da dire ancora
        // (es. «evento nato senza posizione») lo dice alla schermata dopo.
        onNote={setNote}
      />
    );
  }

  if (view === "notaio") {
    return (
      <NotaryScreen
        notary={notary}
        eventId={eventId}
        eventName={event?.name ?? "il tuo evento"}
        onBack={() => setView("attendee")}
      />
    );
  }

  /* ------------------------------------------------- lo stato, in parole */

  const confermato = checkIn?.accredited === true;
  const stato = confermato
    ? {
        tone: T.ok,
        titolo: "Ci sei",
        sotto:
          // «Confermati», non «sei qui da»: la copertura è il tempo che il
          // telefono ha sentito davvero — un limite inferiore, non l'arco
          // dall'arrivo. A schermo bloccato non si campiona, e il numero
          // deve dire quello che è.
          (checkIn?.quality.coverageMinutes ?? 0) >= 1
            ? `${checkIn!.quality.coverageMinutes} minut${checkIn!.quality.coverageMinutes === 1 ? "o" : "i"} di presenza confermati finora. Puoi rimettere il telefono in tasca.`
            : "Puoi rimettere il telefono in tasca.",
      }
    : pending > 0
      ? {
          tone: T.warn,
          titolo: "Ti stiamo riconoscendo",
          sotto: "Sale da solo appena c'è rete — offline non è un problema.",
        }
      : beacon.inRange
        ? {
            tone: T.warn,
            titolo: "Ti sentiamo qui vicino",
            sotto: "Resta pure: la presenza si raccoglie da sola.",
          }
        : {
            tone: T.faint,
            titolo: "Non risulti ancora qui",
            sotto:
              "Sei già sul posto? Inquadra il QR di chi conduce l'evento: due secondi e ci sei.",
          };

  const permessiMancanti = permissions && !(permissions.radio && permissions.wake);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 + insets.bottom },
        ]}
      >
        <Hero name={event?.name ?? "WeMeet"} />

        {/* La card che risale sopra la testata: la forma del dettaglio
            evento dell'app. */}
        <View style={[styles.card, styles.sheet]}>
          <InfoRow
            tile={<Text style={styles.tileGlyph}>{dayOfMonth(event?.startsAt)}</Text>}
            strong={eventDay(event?.startsAt) ?? "Data da definire"}
            sub={eventHours(event?.startsAt, event?.endsAt)}
          />
          <InfoRow
            tile={<PinGlyph />}
            strong="Il posto dell'evento"
            sub={
              event?.geofence
                ? "Ti aspettiamo lì — l'app se ne accorge da sola"
                : "Nessun raggio impostato per questo evento"
            }
          />
          <InfoRow
            tile={<Text style={styles.tileGlyph}>{(name || "?").charAt(0).toUpperCase()}</Text>}
            strong="Ciao,"
            sub={
              <TextInput
                style={styles.nameInline}
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  void setAttendeeName(v);
                }}
                placeholder="scrivi il tuo nome"
                placeholderTextColor={T.faint}
              />
            }
          />
        </View>

        <View style={[styles.card, styles.statusRow]}>
          <View style={[styles.dot, { backgroundColor: stato.tone }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{stato.titolo}</Text>
            <Text style={styles.cardSub}>{stato.sotto}</Text>
          </View>
        </View>

        {permessiMancanti ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Serve un permesso</Text>
            <Text style={styles.cardSub}>
              Senza, il telefono non si accorge da solo che sei arrivato:
              resta il QR qui sotto.
            </Text>
            <PillButton label="Concedi i permessi" onPress={grantPermissions} />
          </View>
        ) : null}

        <OpticalEntry
          eventId={eventId}
          onSubmit={async (code) => {
            // Fotocamera o dita, la strada è UNA: nel borsellino e su.
            await collectCode(eventId, code, new Date());
            await deliverNow();
          }}
        />

        {note ? <Text style={styles.note}>{note}</Text> : null}
        {busy ? <ActivityIndicator color={T.brand} /> : null}

        <Backstage
          beacon={beacon}
          notary={notary}
          serverCode={serverCode}
          collected={collected}
          pending={pending}
          checkIn={checkIn}
          deviceId={deviceId}
          permissions={permissions}
          onDeliver={deliverNow}
          onForget={forgetEvent}
          onNotary={() => setView("notaio")}
        />

        <Text style={styles.footer}>
          La posizione si dichiara, la prossimità si dimostra, la permanenza si
          conferma.
        </Text>
      </ScrollView>

      {/* La barra d'azione a pastiglia: il posto dell'azione principale,
          e la conferma one-tap è la nostra. Il fondo lo decide l'inset:
          sotto ci possono essere i pulsanti di navigazione di Android. */}
      <View
        style={[styles.actionbar, { bottom: Math.max(insets.bottom + 8, 24) }]}
      >
        <Text style={styles.actionbarLabel}>
          {confermato ? "Ci sei ✓" : "Non ancora confermato"}
        </Text>
        <Pressable
          style={[styles.round, confermato && styles.roundDisabled]}
          disabled={confermato}
          onPress={confirmPresence}
        >
          <Text style={styles.roundText}>
            {confermato ? "Confermato" : "Confermo, sono qui"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ componenti */

/**
 * Nell'app vera qui c'è una fotografia a tutto schermo. Le foto di WeRoad
 * sono coperte da diritti (design.md §9): resta la struttura — pastiglia di
 * stato e titolo bianco in basso — su un fondo scuro con un velo corallo,
 * il registro della loro schermata di lancio. Il velo, senza gradienti in
 * dotazione, è fatto di cerchi concentrici traslucidi.
 */
function Hero({
  name,
  pill = "In corso",
  onBack,
}: {
  name: string;
  pill?: string;
  /** Il chevron di ritorno sopra la foto, come nel loro dettaglio evento. */
  onBack?: () => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={[styles.glow, styles.glowBig]} />
      <View style={[styles.glow, styles.glowMid]} />
      <View style={[styles.glow, styles.glowSmall]} />
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={styles.heroBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.heroBackText}>‹</Text>
        </Pressable>
      ) : null}
      <View style={styles.heroFoot}>
        <View style={styles.pillOnPhoto}>
          <Text style={styles.pillOnPhotoText}>{pill}</Text>
        </View>
        <Text style={styles.heroTitle}>{name}</Text>
      </View>
    </View>
  );
}

function InfoRow({
  tile,
  strong,
  sub,
}: {
  tile: React.ReactNode;
  strong: string;
  sub: React.ReactNode;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.tileBox}>{tile}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoStrong}>{strong}</Text>
        {typeof sub === "string" ? <Text style={styles.infoSub}>{sub}</Text> : sub}
      </View>
    </View>
  );
}

/** Un segnaposto di luogo fatto di viste: anello con punto, inchiostro su tessera. */
function PinGlyph() {
  return (
    <View style={styles.pinRing}>
      <View style={styles.pinDot} />
    </View>
  );
}

/**
 * Il canale ottico, per come lo vive l'attendee: l'azione è UNA — inquadra
 * il QR di chi conduce — e il campo a sei cifre resta sotto, discreto, per
 * quando la fotocamera non può (o il QR è dall'altra parte della sala e le
 * cifre te le dettano a voce). Le due strade convergono nello stesso
 * `onSubmit`: da qui in poi il sistema non sa più chi delle due ha portato
 * il codice, ed è giusto così.
 */
function OpticalEntry({
  eventId,
  onSubmit,
}: {
  eventId: string;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const openScanner = async () => {
    // Il permesso si chiede al gesto, non all'avvio: chi non inquadrerà
    // mai niente non deve vedere la richiesta.
    if (!permission?.granted) {
      const asked = await requestPermission();
      if (!asked.granted) {
        setHint(
          "La fotocamera per noi resta spenta — nessun problema: il codice si scrive qui sotto.",
        );
        return;
      }
    }
    setHint(null);
    setScanning(true);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Inquadra e ci sei</Text>
      <Text style={styles.cardSub}>
        Chi conduce l'evento ha un QR sullo schermo: puntaci la fotocamera e
        al resto pensiamo noi.
      </Text>
      <PillButton label="Inquadra il QR" onPress={() => void openScanner()} />
      {hint ? <Text style={styles.cardSub}>{hint}</Text> : null}

      <Text style={styles.orDivider}>oppure inserisci il codice a mano</Text>
      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={setCode}
        placeholder="000000"
        placeholderTextColor={T.faint}
        keyboardType="number-pad"
        maxLength={6}
      />
      <PillButton
        label="Conferma"
        tone="soft"
        onPress={() => {
          if (code.length === 6) {
            void onSubmit(code);
            setCode("");
          }
        }}
      />

      {scanning ? (
        <ScannerSheet
          eventId={eventId}
          onClose={() => setScanning(false)}
          onFound={(found) => {
            setScanning(false);
            // Il feedback positivo sta QUI, vicino al gesto: la consegna
            // vera dirà poi la sua col banner di stato.
            setHint("Preso ✓ — il QR è quello giusto, da qui facciamo noi.");
            void onSubmit(found);
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * La fotocamera a schermo pieno. Il giudizio sul QR non abita qui: sta in
 * lib/optical, puro e testato — qui si tengono solo i due riflessi che una
 * fotocamera impone: lo stesso frame consegnato a raffica non va rigiocato,
 * e dopo il primo codice buono non se ne accetta un secondo.
 */
function ScannerSheet({
  eventId,
  onFound,
  onClose,
}: {
  eventId: string;
  onFound: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [warn, setWarn] = useState<string | null>(null);
  const done = useRef(false);
  const lastScan = useRef<{ data: string; at: number } | null>(null);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (done.current) return;
    const now = Date.now();
    if (!shouldConsiderScan(lastScan.current, data, now)) return;
    lastScan.current = { data, at: now };

    const verdict = opticalVerdict(data, eventId);
    if (verdict.kind === "codice") {
      done.current = true;
      onFound(verdict.code);
      return;
    }
    setWarn(
      verdict.kind === "altro-evento"
        ? "Questo QR è di un altro evento: chiedi quello giusto a chi conduce."
        : "Questo non è il QR dell'evento: cerca quello sullo schermo di chi conduce.",
    );
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={styles.scanner}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
        <Pressable
          onPress={onClose}
          style={[styles.scannerClose, { top: insets.top + 12 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.scannerCloseText}>Chiudi</Text>
        </Pressable>
        <View
          style={[styles.scannerFoot, { paddingBottom: insets.bottom + 24 }]}
        >
          <Text style={styles.scannerHint}>
            {warn ?? "Inquadra il QR sullo schermo di chi conduce l'evento."}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Chi guarda la demo ha bisogno di vedere le etichette vere; chi è
 * all'aperitivo no. Chiuse per default: sono un retroscena, non la
 * schermata (design.md §7).
 */
function Backstage({
  beacon,
  notary,
  serverCode,
  collected,
  pending,
  checkIn,
  deviceId,
  permissions,
  onDeliver,
  onForget,
  onNotary,
}: {
  beacon: ReturnType<typeof useBeaconChannel>;
  notary: NotaryHandle;
  serverCode: string | null;
  collected: number;
  pending: number;
  checkIn: ApiCheckIn | null;
  deviceId: string;
  permissions: PermissionReport | null;
  onDeliver: () => void;
  onForget: () => void;
  onNotary: () => void;
}) {
  const [open, setOpen] = useState(false);
  const radioSays = beacon.lastCode;
  const agreement =
    radioSays && serverCode
      ? radioSays === serverCode
        ? "combaciano"
        : "diversi (finestra scaduta o orologio del beacon)"
      : null;

  return (
    <View style={styles.backstage}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.backstageHead}>
        <Text style={styles.backstageSummary}>
          {open ? "▾" : "▸"} Dietro le quinte (demo)
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          <KV
            k="canale radio"
            v={
              !beacon.available
                ? "modulo assente"
                : beacon.inRange
                  ? "beacon in ascolto"
                  : beacon.listening
                    ? "silenzio radio"
                    : "fermo"
            }
          />
          <KV k="ultimo codice in onda" v={radioSays ?? "——————"} />
          <KV k="codice atteso dal server" v={serverCode ?? "——————"} />
          {agreement ? <KV k="radio e server" v={agreement} /> : null}
          {beacon.lastSighting?.rssi != null ? (
            <KV k="potenza" v={`${beacon.lastSighting.rssi} dBm`} />
          ) : null}
          {beacon.stats ? (
            <KV
              k="radiografia"
              v={`${beacon.stats.results ?? 0} annunci · ${beacon.stats.apple ?? 0} apple · ${beacon.stats.ibeacon ?? 0} ibeacon`}
            />
          ) : null}
          {beacon.stats?.lastUuid ? (
            <KV k="ultimo uuid sentito" v={`${beacon.stats.lastUuid.slice(0, 8)}…`} />
          ) : null}
          {beacon.stats?.error ? (
            <KV k="errore scansione" v={beacon.stats.error} />
          ) : null}
          {beacon.error ? <KV k="errore radio" v={beacon.error} /> : null}
          <KV k="codici raccolti" v={String(collected)} />
          <KV k="in attesa di consegna" v={String(pending)} />
          {checkIn ? (
            <>
              <KV k="provenienza" v={provenanceLabel(checkIn.provenance)} />
              <KV
                k="qualità"
                v={`${checkIn.quality.validCodes} codici · ${checkIn.quality.coverageMinutes} min${checkIn.quality.tappedNotification ? " · tap" : ""}`}
              />
              <KV k="accreditato" v={checkIn.accredited ? "sì" : "no"} />
            </>
          ) : (
            <KV k="check-in" v="nessuna consegna verificata" />
          )}
          {permissions ? (
            <KV
              k="permessi"
              v={`radio ${permissions.radio ? "ok" : "no"} · risveglio ${permissions.wake ? "ok" : "no"} · notifiche ${permissions.notifications ? "ok" : "no"}`}
            />
          ) : null}
          <KV k="device" v={deviceId.slice(0, 8)} />
          {notary.active ? (
            <KV
              k="notaio"
              v={notary.emitting ? `in onda · ${notary.code ?? ""}` : "attivo, radio ferma"}
            />
          ) : null}
          <View style={styles.backstageActions}>
            <PillButton label="Consegna adesso" tone="soft" onPress={onDeliver} />
            <PillButton label="Cambia evento" tone="soft" onPress={onForget} />
          </View>
          <View style={styles.backstageActions}>
            <PillButton
              label={notary.active ? "Modalità notaio · in corso" : "Conduci tu? Modalità notaio"}
              tone="soft"
              onPress={onNotary}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * La superficie dell'host: il telefono che gioca il ruolo del notaio.
 *
 * In alto il QR — il canale ottico, derivato QUI dal seme che l'incarico
 * custodisce in locale: la rete del locale può morire, lo schermo no. Il
 * payload è identico a quello della console web, così l'app di chi
 * inquadra non distingue chi l'ha disegnato. Sotto, gli arrivi in tempo
 * reale: è il telefono appoggiato sul tavolo di chi conduce, e la lista si
 * aggiorna da sola finché la schermata resta aperta.
 *
 * Restano a schermo lo stato dell'emissione (un notaio morto è rumoroso,
 * non silenzioso) e il limite di piattaforma — su iPhone si emette a
 * schermata aperta, su Android anche in tasca. Le etichette tecniche
 * stanno nel dietro le quinte, come sulla schermata dell'attendee.
 */
function NotaryScreen({
  notary,
  eventId,
  eventName,
  onBack,
}: {
  notary: NotaryHandle;
  eventId: string;
  eventName: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [arrivals, setArrivals] = useState<ApiCheckIn[] | null>(null);

  // Il polling vive nella schermata apposta: chiuderla lo ferma. Un giro
  // fallito non svuota la lista — si resta sull'ultima fotografia buona.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchCheckIns(eventId)
        .then((list) => {
          if (alive) setArrivals(list);
        })
        .catch(() => {});
    tick();
    const timer = setInterval(tick, 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [eventId]);

  const emissione = notary.active
    ? notary.emitting
      ? {
          pill: "In onda",
          titolo: "In onda",
          sotto: "I telefoni intorno sentono il codice dell'evento.",
        }
      : {
          pill: "Radio ferma",
          titolo: "Attivo, ma la radio tace",
          sotto:
            notary.bluetooth === "spento"
              ? "Il Bluetooth è spento: riaccendilo e riparte da solo."
              : "Un momento: la radio si sta preparando.",
        }
    : {
        pill: "Modalità notaio",
        titolo: "Non stai emettendo",
        sotto: "Attiva l'emissione per far esistere il canale radio.",
      };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 + insets.bottom },
        ]}
      >
        <Hero name={eventName} pill={emissione.pill} onBack={onBack} />

        {/* La card che risale sopra la testata: il QR da far inquadrare,
            con le cifre sotto per chi se le fa dettare. */}
        <View style={[styles.card, styles.sheet, styles.qrCard]}>
          {notary.active && notary.code ? (
            <>
              <QRCode
                value={opticalPayload(eventId, notary.code)}
                size={208}
                color={T.ink}
                backgroundColor={T.surface}
              />
              <Text style={styles.qrDigits}>{notary.code}</Text>
              <Text style={[styles.cardSub, styles.qrSub]}>
                Fallo inquadrare a chi arriva — o fai copiare le cifre. Si
                rinnova da solo ogni mezzo minuto.
              </Text>
            </>
          ) : (
            <Text style={[styles.cardSub, styles.qrSub]}>
              Il QR da far inquadrare compare qui appena inizi a emettere.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <InfoRow
            tile={<BroadcastGlyph muted={!notary.emitting} />}
            strong={emissione.titolo}
            sub={emissione.sotto}
          />
          <InfoRow
            tile={<PhoneGlyph />}
            strong={
              Platform.OS === "ios"
                ? "Emette a schermata aperta"
                : "Puoi metterlo in tasca"
            }
            sub={
              Platform.OS === "ios"
                ? "È un limite di iPhone, non un guasto: tienilo in carica, a non farlo spegnere ci pensiamo noi. Consuma meno dello schermo acceso."
                : "L'emissione continua a schermo spento, tutta la sera: la notifica fissa ti ricorda che stai emettendo. Consuma meno dello schermo acceso."
            }
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Chi è arrivato</Text>
          {arrivals === null ? (
            <ActivityIndicator color={T.brand} />
          ) : arrivals.length === 0 ? (
            <Text style={styles.cardSub}>
              Ancora nessuno: i primi compaiono qui da soli, senza ricaricare.
            </Text>
          ) : (
            [...arrivals]
              .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
              .map((arrival) => (
                <ArrivalRow key={arrival.deviceId} arrival={arrival} />
              ))
          )}
        </View>

        {notary.error ? <Text style={styles.note}>{notary.error}</Text> : null}
        {notary.busy ? <ActivityIndicator color={T.brand} /> : null}

        <NotaryBackstage notary={notary} />

        <Text style={styles.footer}>
          Condurre è un ruolo, non un oggetto: stasera lo gioca questo
          telefono. Fermarlo spegne il codice e lo dimentica.
        </Text>
      </ScrollView>

      {/* La stessa barra a pastiglia del resto dell'app: etichetta a
          sinistra, azione corallo a destra — il loro «Partecipa». */}
      <View
        style={[styles.actionbar, { bottom: Math.max(insets.bottom + 8, 24) }]}
      >
        <Text style={styles.actionbarLabel}>
          {notary.active ? (notary.emitting ? "In onda ✓" : "Radio ferma") : "Non stai emettendo"}
        </Text>
        <Pressable
          style={styles.round}
          onPress={() =>
            void (notary.active ? notary.deactivate() : notary.activate())
          }
        >
          <Text style={styles.roundText}>
            {notary.active ? "Ferma" : "Inizia a emettere"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Una riga d'arrivo, in parole: la console web mostra le etichette
 * (provenienza, qualità), qui si legge una frase — chi conduce è in piedi
 * con un telefono in mano, non seduto a interpretare una tabella. I minuti
 * sono la copertura, cioè un limite inferiore: da qui l'«almeno».
 */
function ArrivalRow({ arrival }: { arrival: ApiCheckIn }) {
  const name = arrival.attendeeName?.trim() || "Senza nome";
  // Primo code point, non primo char: un nome che inizia con un'emoji
  // (la sandbox li usa) con charAt mostrerebbe mezzo surrogato.
  const initial = ([...name][0] ?? "·").toUpperCase();
  const minutes = arrival.quality.coverageMinutes;
  const presenza =
    minutes >= 1
      ? `qui da almeno ${minutes} minut${minutes === 1 ? "o" : "i"}`
      : "appena arrivato";
  const conferma =
    arrival.provenance === "machine+human"
      ? "confermato dal suo telefono e da te"
      : arrival.provenance === "machine"
        ? "lo conferma il suo telefono"
        : arrival.provenance === "human"
          ? "confermato da te"
          : "ancora nessuna conferma";
  return (
    <View style={styles.infoRow}>
      <View style={styles.tileBox}>
        <Text style={styles.tileGlyph}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoStrong}>{name}</Text>
        <Text style={styles.infoSub}>
          {presenza} · {conferma}
        </Text>
      </View>
      <View
        style={[styles.arrivalPill, arrival.accredited && styles.arrivalPillOn]}
      >
        <Text
          style={[
            styles.arrivalPillText,
            arrival.accredited && styles.arrivalPillTextOn,
          ]}
        >
          {arrival.accredited ? "C'è" : "Quasi"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Il retroscena del notaio: le etichette vere dell'emissione, chiuse per
 * default come sull'altra schermata — chi guarda la demo le apre, chi
 * conduce l'aperitivo no.
 */
function NotaryBackstage({ notary }: { notary: NotaryHandle }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.backstage}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.backstageHead}>
        <Text style={styles.backstageSummary}>
          {open ? "▾" : "▸"} Dietro le quinte (demo)
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          <KV k="codice rotante in onda" v={notary.code ?? "——————"} />
          <KV
            k="radio"
            v={
              notary.active
                ? notary.emitting
                  ? "annuncio in onda"
                  : "ferma"
                : "incarico non attivo"
            }
          />
          {notary.bluetooth ? <KV k="bluetooth" v={notary.bluetooth} /> : null}
          <KV
            k="modulo radio"
            v={notary.available ? "presente" : "assente (serve una dev build)"}
          />
          <KV k="rotazione" v="ogni 30 s, al confine di finestra, offline" />
          <KV k="payload del qr" v="{e, c} — identico alla console web" />
        </View>
      ) : null}
    </View>
  );
}

/** Il glifo dell'emissione: un punto che allarga cerchi — fatto di viste,
 *  come il segnaposto, inchiostro su tessera. */
function BroadcastGlyph({ muted = false }: { muted?: boolean }) {
  const ink = muted ? T.faint : T.inkStrong;
  return (
    <View style={styles.broadcastBox}>
      <View style={[styles.broadcastRing, styles.broadcastRingOuter, { borderColor: ink }]} />
      <View style={[styles.broadcastRing, styles.broadcastRingInner, { borderColor: ink }]} />
      <View style={[styles.pinDot, { backgroundColor: ink }]} />
    </View>
  );
}

/** Un telefono stilizzato: cornice arrotondata e tacca dell'altoparlante. */
function PhoneGlyph() {
  return (
    <View style={styles.phoneBody}>
      <View style={styles.phoneNotch} />
    </View>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal}>{v}</Text>
    </View>
  );
}

function PillButton({
  label,
  onPress,
  tone = "solid",
}: {
  label: string;
  onPress: () => void;
  tone?: "solid" | "soft";
}) {
  return (
    <Pressable
      style={[styles.pillButton, tone === "soft" && styles.pillButtonSoft]}
      onPress={onPress}
    >
      <Text
        style={[styles.pillButtonText, tone === "soft" && styles.pillButtonTextSoft]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function EventPicker({
  onPick,
  onNote,
}: {
  onPick: (eventId: string, name: string) => Promise<void>;
  /** L'ultimo messaggio del picker, recapitato alla schermata che segue. */
  onNote: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<ApiEvent[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /**
   * La nascita sul posto: l'evento parte adesso, dura sei ore, e nasce
   * dove sei — il cerchio è quello che poi sveglierà i telefoni di chi
   * arriva. Se la posizione non c'è (permesso negato, GPS muto) si crea
   * lo stesso, senza cerchio: lo si dice con garbo alla schermata dopo,
   * perché questa se ne sta andando.
   */
  const createAndEnter = async () => {
    const trimmed = newEventName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);

    const geofence = await currentGeofence();
    const now = new Date();
    let created: ApiEvent;
    try {
      created = await createEvent({
        name: trimmed,
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
        ...(geofence ? { geofence } : {}),
      });
    } catch {
      setCreateError(
        "Non siamo riusciti a creare l'evento: controlla la rete e riprova.",
      );
      setCreating(false);
      return;
    }
    if (!geofence) {
      onNote(
        "L'evento è nato senza sapere dove si trova: funziona tutto lo stesso, solo che l'app non potrà accorgersi da sola di chi arriva.",
      );
    }
    // Lo stesso flusso della scelta: chi crea entra come tutti gli altri.
    // Se l'ingresso inciampa (raro: le scritture sono locali) lo spinner
    // non deve restare appeso su un evento che ormai esiste.
    try {
      await onPick(created.id, name);
    } catch {
      setCreating(false);
      setCreateError(
        "L'evento è nato ma non siamo riusciti a entrarci: toccalo nella lista qui sopra.",
      );
    }
  };

  // La lista degli eventi recenti, da toccare: l'id a mano resta come
  // riserva per quando la rete non c'è o l'evento non è in lista. Un
  // primo colpo a vuoto (WiFi che si riaggancia, DNS che inciampa) non
  // deve congelare la schermata: si riprova da soli, e c'è «Ricarica».
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (retriesLeft: number) => {
      fetchEvents()
        .then((list) => {
          if (!cancelled) setEvents(list);
        })
        .catch(() => {
          if (cancelled) return;
          if (retriesLeft > 0) {
            retryTimer = setTimeout(() => load(retriesLeft - 1), 3_000);
          } else {
            setEvents([]);
          }
        });
    };
    setEvents(null);
    load(3);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [attempt]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {/* handled: col tastierino aperto (hai appena scritto il nome) il primo
          tocco su un evento deve SCEGLIERLO, non limitarsi a chiudere la
          tastiera — senza questo, il primo tap della lista muore sempre lì. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 40 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Hero name="A quale evento vai?" />
        <View style={[styles.card, styles.sheet]}>
          <Text style={styles.cardSub}>Prima dicci chi sei, poi tocca il tuo evento.</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="il tuo nome (facoltativo)"
            placeholderTextColor={T.faint}
          />
        </View>

        <View style={styles.card}>
          {events === null ? (
            <ActivityIndicator color={T.brand} />
          ) : events.length === 0 ? (
            <>
              <Text style={styles.cardSub}>
                Nessun evento in lista (o niente rete): riprova, o incolla
                l'id qui sotto.
              </Text>
              <PillButton
                label="Ricarica"
                tone="soft"
                onPress={() => setAttempt((n) => n + 1)}
              />
            </>
          ) : (
            events.map((event) => (
              <Pressable key={event.id} onPress={() => void onPick(event.id, name)}>
                <InfoRow
                  tile={<Text style={styles.tileGlyph}>{dayOfMonth(event.startsAt)}</Text>}
                  strong={event.name}
                  sub={`${eventDay(event.startsAt) ?? ""} · ${eventHours(event.startsAt, event.endsAt)}`}
                />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Il tuo evento non c'è?</Text>
          <Text style={styles.cardSub}>
            Crealo: parte adesso, dura sei ore, e nasce dove sei tu.
          </Text>
          <TextInput
            style={styles.input}
            value={newEventName}
            onChangeText={setNewEventName}
            placeholder="il nome dell'evento"
            placeholderTextColor={T.faint}
          />
          {createError ? (
            <Text style={styles.cardSub}>{createError}</Text>
          ) : null}
          {creating ? (
            <ActivityIndicator color={T.brand} />
          ) : (
            <PillButton label="Crea ed entra" onPress={() => void createAndEnter()} />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardSub}>
            Oppure incolla l'id dell'evento (te lo dà chi conduce).
          </Text>
          <TextInput
            style={styles.input}
            value={id}
            onChangeText={setId}
            placeholder="id evento"
            placeholderTextColor={T.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PillButton
            label="Entra"
            onPress={() => {
              if (id.trim()) void onPick(id, name);
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Il cerchio dell'evento appena creato: la posizione di chi lo crea, ora.
 *
 * Il permesso si chiede qui, al gesto di creare — non all'avvio. Un GPS
 * indoor può metterci un'eternità: dopo dieci secondi ci si accontenta
 * dell'ultima posizione nota, e se non c'è nemmeno quella l'evento nasce
 * senza cerchio (il chiamante lo racconta). 150 metri di raggio: largo
 * abbastanza da perdonare l'errore GPS di un interno — e comunque sotto i
 * 100 il registro del geofence non scende (tasks.ts).
 */
async function currentGeofence(): Promise<{
  lat: number;
  lng: number;
  radiusM: number;
} | null> {
  try {
    let { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) {
      granted = (await Location.requestForegroundPermissionsAsync()).granted;
    }
    if (!granted) return null;
    const position =
      (await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ])) ?? (await Location.getLastKnownPositionAsync());
    if (!position) return null;
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      radiusM: 150,
    };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- date */

/** Loro scrivono «Mercoledì, 5 Agosto 2026»: iniziali maiuscole e virgola
 *  dopo il giorno. Stiamo somigliando a loro, non correggendoli. */
function eventDay(iso?: string): string | null {
  if (!iso) return null;
  try {
    const parti = new Intl.DateTimeFormat("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).formatToParts(new Date(iso));
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const get = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
    return `${cap(get("weekday"))}, ${get("day")} ${cap(get("month"))} ${get("year")}`;
  } catch {
    return new Date(iso).toDateString();
  }
}

function eventHours(startsAt?: string, endsAt?: string): string {
  if (!startsAt || !endsAt) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${hm(startsAt)} – ${hm(endsAt)}`;
}

function dayOfMonth(iso?: string): string {
  return iso ? String(new Date(iso).getDate()) : "·";
}

function provenanceLabel(provenance: ApiCheckIn["provenance"]): string {
  switch (provenance) {
    case "machine":
      return "macchina";
    case "human":
      return "umano";
    case "machine+human":
      return "macchina + umano";
    default:
      return "nessuno";
  }
}

/* ----------------------------------------------------------------- stile */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.sandDeep },
  content: { paddingBottom: 120 },

  /* --- testata --- */
  hero: {
    height: 240,
    backgroundColor: T.ink,
    overflow: "hidden",
    justifyContent: "flex-end",
    padding: 16,
  },
  glow: {
    position: "absolute",
    borderRadius: T.rFull,
    backgroundColor: "rgba(255, 71, 88, 0.14)",
  },
  glowBig: { width: 420, height: 420, top: -230, right: -150 },
  glowMid: { width: 300, height: 300, top: -170, right: -90 },
  glowSmall: { width: 190, height: 190, top: -110, right: -40 },
  heroFoot: { paddingBottom: 32 },
  heroBack: { position: "absolute", top: 58, left: 16, zIndex: 1 },
  heroBackText: {
    color: "#fff",
    fontSize: 34,
    lineHeight: 36,
    fontWeight: "600",
  },
  pillOnPhoto: {
    alignSelf: "flex-start",
    backgroundColor: T.surface,
    borderRadius: T.rFull,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillOnPhotoText: { color: T.inkStrong, fontSize: 14, fontWeight: "500" },
  heroTitle: {
    color: "#fff",
    fontSize: 30,
    lineHeight: 33,
    fontWeight: "700",
    marginTop: 8,
  },

  /* --- card bianche, senza bordo: si staccano dalla sabbia per contrasto --- */
  card: {
    backgroundColor: T.surface,
    borderRadius: T.rCard,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    gap: 8,
  },
  sheet: { marginTop: -24 },

  infoRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 6 },
  tileBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: T.tile,
    alignItems: "center",
    justifyContent: "center",
  },
  tileGlyph: { color: T.inkStrong, fontSize: 17, fontWeight: "700" },
  pinRing: {
    width: 16,
    height: 16,
    borderRadius: T.rFull,
    borderWidth: 2,
    borderColor: T.inkStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  pinDot: { width: 5, height: 5, borderRadius: T.rFull, backgroundColor: T.inkStrong },
  infoStrong: { color: T.inkStrong, fontSize: 17, fontWeight: "600" },
  infoSub: { color: T.muted, fontSize: 15, marginTop: 1 },
  nameInline: {
    borderBottomWidth: 1,
    borderBottomColor: T.line,
    paddingVertical: 2,
    fontSize: 15,
    color: T.inkStrong,
  },

  /* --- stato --- */
  statusRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  dot: { width: 10, height: 10, borderRadius: T.rFull, marginTop: 8 },
  statusTitle: { color: T.ink, fontSize: 20, lineHeight: 24, fontWeight: "700" },

  cardTitle: { color: T.inkStrong, fontSize: 17, fontWeight: "600" },
  cardSub: { color: T.muted, fontSize: 15, lineHeight: 21 },

  /* La card del QR del notaio: il canale ottico, centrato. Le cifre sotto
     restano leggibili dall'altra parte del tavolo, per chi se le fa
     dettare invece di inquadrare. */
  qrCard: { alignItems: "center", paddingVertical: 24 },
  qrDigits: {
    color: T.inkStrong,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: 8,
    marginTop: 12,
    fontVariant: ["tabular-nums"],
  },
  qrSub: { textAlign: "center" },

  /* Gli arrivi sulla schermata del notaio: la pastiglia di stato dell'app
     (fondo incassato, testo tenue), che diventa nera — lo stato attivo del
     loro linguaggio — quando la presenza è accreditata. */
  arrivalPill: {
    alignSelf: "center",
    backgroundColor: T.surfaceSunken,
    borderRadius: T.rFull,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  arrivalPillOn: { backgroundColor: T.ink },
  arrivalPillText: { color: "#737373", fontSize: 13, fontWeight: "500" },
  arrivalPillTextOn: { color: "#fff" },

  /* --- glifi della modalità notaio: viste, non icone --- */
  broadcastBox: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  broadcastRing: { position: "absolute", borderWidth: 1.5, borderRadius: T.rFull },
  broadcastRingOuter: { width: 24, height: 24, opacity: 0.35 },
  broadcastRingInner: { width: 15, height: 15, opacity: 0.7 },
  phoneBody: {
    width: 14,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: T.inkStrong,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  phoneNotch: {
    width: 5,
    height: 2,
    borderRadius: T.rFull,
    backgroundColor: T.inkStrong,
  },
  note: { color: T.inkStrong, fontSize: 14, marginHorizontal: 32, marginBottom: 12 },

  input: {
    backgroundColor: T.surfaceSunken,
    borderRadius: 12,
    color: T.inkStrong,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeInput: {
    backgroundColor: T.surfaceSunken,
    borderRadius: 12,
    color: T.inkStrong,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 6,
    textAlign: "center",
    paddingVertical: 12,
    fontVariant: ["tabular-nums"],
  },
  /* L'alternativa discreta sotto l'azione primaria: solo testo, tenue. */
  orDivider: {
    color: T.faint,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },

  /* --- la fotocamera a schermo pieno --- */
  scanner: { flex: 1, backgroundColor: T.ink },
  /* Sul feed live vale la convenzione dei controlli su foto: pastiglia
     bianca, testo inchiostro (design.md, «pastiglia di stato su foto»). */
  scannerClose: {
    position: "absolute",
    right: 16,
    backgroundColor: "#ffffff",
    borderRadius: T.rFull,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  scannerCloseText: { color: "#262626", fontSize: 15, fontWeight: "600" },
  scannerFoot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  /* Deviazione voluta dalla pastiglia bianca: il suggerimento è una frase
     lunga e sta sopra un feed imprevedibile — lo scrim scuro tiene il
     testo leggibile su qualunque inquadratura senza accecare al buio. */
  scannerHint: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    backgroundColor: "rgba(23, 23, 23, 0.55)",
    borderRadius: T.rCard,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
  },

  /* Nell'app tutto ciò che si tocca è completamente arrotondato. */
  pillButton: {
    backgroundColor: T.brand,
    borderRadius: T.rFull,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pillButtonSoft: { backgroundColor: T.surfaceSunken },
  pillButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  pillButtonTextSoft: { color: T.inkStrong },

  /* --- dietro le quinte --- */
  backstage: { marginHorizontal: 16, marginBottom: 16 },
  backstageHead: { paddingVertical: 8 },
  backstageSummary: { color: T.muted, fontSize: 14 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  kvKey: { color: T.faint, fontSize: 13 },
  kvVal: {
    color: T.inkStrong,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
    textAlign: "right",
  },
  backstageActions: { flexDirection: "row", gap: 8, marginTop: 10 },

  /* --- barra d'azione --- */
  actionbar: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: T.surface,
    borderRadius: T.rFull,
    paddingVertical: 8,
    paddingRight: 8,
    paddingLeft: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: T.ink,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  actionbarLabel: { color: T.inkStrong, fontSize: 16, flexShrink: 1 },
  round: {
    backgroundColor: T.brand,
    borderRadius: T.rFull,
    height: 48,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  roundDisabled: { backgroundColor: "rgba(255, 71, 88, 0.45)" },
  roundText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  footer: {
    color: T.faint,
    fontSize: 12,
    fontStyle: "italic",
    marginHorizontal: 32,
    marginBottom: 8,
  },
});
