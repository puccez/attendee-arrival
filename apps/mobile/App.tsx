import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { WemeetBeacon } from "./modules/wemeet-beacon";
import { useBeaconChannel } from "./src/beacon/useBeaconChannel";
import { useNotary, type NotaryHandle } from "./src/notary/useNotary";
import {
  fetchCurrentCode,
  fetchEvent,
  fetchEvents,
  type ApiCheckIn,
  type ApiEvent,
} from "./src/lib/api";
import { BEACON_UUID, FLUSH_INTERVAL_MS } from "./src/lib/config";
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

export default function App() {
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
    void (async () => {
      await refreshWallet();
      // Tutto ciò che il canale radio ha accumulato mentre l'app dormiva.
      if (await drainRadioBacklog(eventId)) await refreshWallet();
      try {
        const loaded = await fetchEvent(eventId);
        setEvent(loaded);
        await writeSetting(SETTING_EVENT_NAME, loaded.name);
        if (loaded.geofence) await startGeofence(loaded.geofence).catch(() => {});
      } catch {
        setNote("Evento non raggiungibile: l'app raccoglie lo stesso, offline.");
      }
    })();
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
      setNote(
        report.delivered > 0
          ? `Consegnati ${report.delivered} elementi del borsellino.`
          : report.retryLater > 0
            ? "Niente rete: il borsellino aspetta e ritenta da solo."
            : "Borsellino vuoto: nessun codice da consegnare.",
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
      />
    );
  }

  if (view === "notaio") {
    return (
      <NotaryScreen
        notary={notary}
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
            titolo: "Il beacon ti sente",
            sotto: "Resta pure qui: la presenza si raccoglie da sola.",
          }
        : {
            tone: T.faint,
            titolo: "Non risulti ancora qui",
            sotto: "Avvicinati al beacon, o inserisci il codice del coordinatore.",
          };

  const permessiMancanti = permissions && !(permissions.radio && permissions.wake);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
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
              Senza, il telefono non può sentire il beacon da solo: resta il
              codice a mano qui sotto.
            </Text>
            <PillButton label="Concedi i permessi" onPress={grantPermissions} />
          </View>
        ) : null}

        <ManualCode
          onSubmit={async (code) => {
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
          e la conferma one-tap è la nostra. */}
      <View style={styles.actionbar}>
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

function ManualCode({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Il codice del coordinatore</Text>
      <Text style={styles.cardSub}>
        Se la radio non arriva, il codice è lo stesso: leggilo dallo schermo di
        chi conduce l'evento. Cambia ogni 30 secondi.
      </Text>
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
        label="Aggiungi al borsellino"
        tone="soft"
        onPress={() => {
          if (code.length === 6) {
            void onSubmit(code);
            setCode("");
          }
        }}
      />
    </View>
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
 * Le due promesse della spec, entrambe a schermo: lo stato dell'emissione
 * in evidenza (un notaio morto è rumoroso, non silenzioso) e il limite di
 * piattaforma dichiarato invece che scoperto a fine serata — su iPhone si
 * emette a schermata aperta, su Android anche in tasca.
 */
function NotaryScreen({
  notary,
  eventName,
  onBack,
}: {
  notary: NotaryHandle;
  eventName: string;
  onBack: () => void;
}) {
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
      <ScrollView contentContainerStyle={styles.content}>
        <Hero name={eventName} pill={emissione.pill} onBack={onBack} />

        {/* La card che risale sopra la testata, come il loro dettaglio
            evento: righe tessera + titolo + sottotitolo. */}
        <View style={[styles.card, styles.sheet]}>
          <Text style={styles.notaryCode}>
            {notary.active && notary.code ? notary.code : "——————"}
          </Text>
          <Text style={[styles.cardSub, styles.notaryCodeSub]}>
            Il Codice Rotante in onda adesso · cambia ogni 30 secondi, insieme
            alla console
          </Text>
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

        {notary.error ? <Text style={styles.note}>{notary.error}</Text> : null}
        {notary.busy ? <ActivityIndicator color={T.brand} /> : null}

        <Text style={styles.footer}>
          Il notaio è un ruolo, non un oggetto: stasera lo gioca questo
          telefono. Fermarlo cancella il seme.
        </Text>
      </ScrollView>

      {/* La stessa barra a pastiglia del resto dell'app: etichetta a
          sinistra, azione corallo a destra — il loro «Partecipa». */}
      <View style={styles.actionbar}>
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
}: {
  onPick: (eventId: string, name: string) => Promise<void>;
}) {
  const [events, setEvents] = useState<ApiEvent[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [id, setId] = useState("");
  const [name, setName] = useState("");

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
      <ScrollView contentContainerStyle={styles.content}>
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

  /* Il codice del notaio: grande come sulla console, si legge dall'altra
     parte del tavolo. */
  notaryCode: {
    color: T.inkStrong,
    fontSize: 44,
    fontWeight: "700",
    letterSpacing: 10,
    textAlign: "center",
    paddingVertical: 8,
    fontVariant: ["tabular-nums"],
  },
  notaryCodeSub: { textAlign: "center" },

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
