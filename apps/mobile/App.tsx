import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { WemeetBeacon } from "./modules/wemeet-beacon";
import { useBeaconChannel } from "./src/beacon/useBeaconChannel";
import { fetchCurrentCode, fetchEvent, type ApiCheckIn, type ApiEvent } from "./src/lib/api";
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
 */
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

  const beacon = useBeaconChannel(eventId);
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
    await stopGeofence();
    await WemeetBeacon?.stopMonitoringAsync().catch(() => {});
    await writeSetting(SETTING_EVENT_ID, "");
    setEventId(null);
    setEvent(null);
    setCheckIn(null);
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

  const radioSays = beacon.lastCode;
  const agreement =
    radioSays && serverCode
      ? radioSays === serverCode
        ? "combaciano"
        : "diversi (finestra scaduta o orologio del beacon)"
      : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="light" />

      <Text style={styles.kicker}>WeMeet check-in</Text>
      <Text style={styles.title}>{event?.name ?? "Evento"}</Text>
      <Text style={styles.muted}>
        {name ? `${name} · ` : ""}device {deviceId.slice(0, 8)}
      </Text>

      <Card>
        <Row label="Canale radio">
          <Badge
            tone={beacon.inRange ? "good" : beacon.listening ? "wait" : "off"}
            text={
              !beacon.available
                ? "modulo assente"
                : beacon.inRange
                  ? "beacon in ascolto"
                  : beacon.listening
                    ? "silenzio radio"
                    : "fermo"
            }
          />
        </Row>
        <Row label="Ultimo codice in onda">
          <Text style={styles.code}>{radioSays ?? "——————"}</Text>
        </Row>
        <Row label="Codice atteso dal server">
          <Text style={styles.code}>{serverCode ?? "——————"}</Text>
        </Row>
        {agreement ? (
          <Text style={styles.muted}>
            Radio e server: {agreement}. Stesso codice, due canali.
          </Text>
        ) : null}
        {beacon.lastSighting?.rssi != null ? (
          <Text style={styles.muted}>
            Potenza {beacon.lastSighting.rssi} dBm — indica la distanza, non
            prova niente.
          </Text>
        ) : null}
        {beacon.error ? <Text style={styles.warn}>{beacon.error}</Text> : null}
      </Card>

      <Card>
        <Row label="Borsellino">
          <Text style={styles.value}>{collected} codici raccolti</Text>
        </Row>
        <Row label="In attesa di consegna">
          <Text style={styles.value}>{pending}</Text>
        </Row>
        <Text style={styles.muted}>
          I codici salgono da soli appena c'è rete. Offline non è un caso
          d'errore.
        </Text>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Il mio check-in</Text>
        {checkIn ? (
          <>
            <Row label="Provenienza">
              <Badge
                tone={checkIn.provenance === "none" ? "off" : "good"}
                text={provenanceLabel(checkIn.provenance)}
              />
            </Row>
            <Row label="Qualità">
              <Text style={styles.value}>
                {checkIn.quality.validCodes} codici · {checkIn.quality.coverageMinutes} min
                {checkIn.quality.tappedNotification ? " · tap" : ""}
              </Text>
            </Row>
            <Text style={styles.muted}>
              {checkIn.accredited
                ? "Presenza accreditata."
                : "Arrivata, non ancora testimoniata."}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>
            Ancora nessuna consegna. Avvicinati al beacon: i codici si
            raccolgono da soli.
          </Text>
        )}
      </Card>

      {permissions && !(permissions.radio && permissions.wake) ? (
        <Card>
          <Text style={styles.cardTitle}>Permessi</Text>
          <Text style={styles.muted}>
            Radio {permissions.radio ? "ok" : "mancante"} · risveglio{" "}
            {permissions.wake ? "ok" : "mancante"} · notifiche{" "}
            {permissions.notifications ? "ok" : "mancanti"}. Nessuno è
            obbligatorio: senza, resta il codice a mano.
          </Text>
          <Button label="Concedi i permessi" onPress={grantPermissions} />
        </Card>
      ) : null}

      <ManualCode
        onSubmit={async (code) => {
          await collectCode(eventId, code, new Date());
          await deliverNow();
        }}
      />

      {note ? <Text style={styles.note}>{note}</Text> : null}
      {busy ? <ActivityIndicator color="#f5b301" /> : null}

      <Button label="Consegna adesso" onPress={deliverNow} />
      <Button label="Confermo di essere qui" onPress={confirmPresence} />
      <Button label="Cambia evento" onPress={forgetEvent} tone="ghost" />

      <Text style={styles.footer}>
        La posizione si dichiara, la prossimità si dimostra, la permanenza si
        conferma.
      </Text>
    </ScrollView>
  );
}

/* ------------------------------------------------------------ componenti */

function EventPicker({
  onPick,
}: {
  onPick: (eventId: string, name: string) => Promise<void>;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <Text style={styles.kicker}>WeMeet check-in</Text>
      <Text style={styles.title}>A quale evento vai?</Text>
      <Text style={styles.muted}>
        Incolla l'id dell'evento (te lo dà la console dell'host). Il telefono
        non ha bisogno d'altro: il resto arriva dal beacon.
      </Text>
      <TextInput
        style={styles.input}
        value={id}
        onChangeText={setId}
        placeholder="id evento"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="il tuo nome (facoltativo)"
        placeholderTextColor="#6b7280"
      />
      <Button
        label="Entra"
        onPress={() => {
          if (id.trim()) void onPick(id, name);
        }}
      />
    </ScrollView>
  );
}

function ManualCode({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  return (
    <Card>
      <Text style={styles.cardTitle}>Canale ottico</Text>
      <Text style={styles.muted}>
        Se la radio non arriva, il codice è lo stesso: leggilo dallo schermo
        dell'host. Scade in 30 secondi, quindi uno screenshot non serve a
        niente.
      </Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="000000"
        placeholderTextColor="#6b7280"
        keyboardType="number-pad"
        maxLength={6}
      />
      <Button
        label="Aggiungi al borsellino"
        onPress={() => {
          if (code.length === 6) {
            void onSubmit(code);
            setCode("");
          }
        }}
      />
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Badge({ tone, text }: { tone: "good" | "wait" | "off"; text: string }) {
  return (
    <View style={[styles.badge, styles[`badge_${tone}`]]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  tone = "solid",
}: {
  label: string;
  onPress: () => void;
  tone?: "solid" | "ghost";
}) {
  return (
    <Pressable
      style={[styles.button, tone === "ghost" && styles.buttonGhost]}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, tone === "ghost" && styles.buttonTextGhost]}>
        {label}
      </Text>
    </Pressable>
  );
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0f14" },
  content: { padding: 20, paddingTop: 64, gap: 12 },
  kicker: { color: "#f5b301", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  title: { color: "#f8fafc", fontSize: 28, fontWeight: "700" },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 19 },
  warn: { color: "#fca5a5", fontSize: 13 },
  note: { color: "#f5b301", fontSize: 13 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  cardTitle: { color: "#e2e8f0", fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { color: "#94a3b8", fontSize: 13, flexShrink: 1 },
  value: { color: "#f8fafc", fontSize: 15, fontWeight: "600" },
  code: { color: "#f8fafc", fontSize: 22, fontWeight: "700", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badge_good: { backgroundColor: "#065f46" },
  badge_wait: { backgroundColor: "#78350f" },
  badge_off: { backgroundColor: "#374151" },
  badgeText: { color: "#f8fafc", fontSize: 12, fontWeight: "600" },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#1f2937",
    borderWidth: 1,
    borderRadius: 10,
    color: "#f8fafc",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: "#f5b301",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#374151" },
  buttonText: { color: "#0b0f14", fontSize: 15, fontWeight: "700" },
  buttonTextGhost: { color: "#e2e8f0" },
  footer: { color: "#475569", fontSize: 12, fontStyle: "italic", marginTop: 8 },
});
