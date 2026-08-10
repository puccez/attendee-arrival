import * as Notifications from "expo-notifications";

/**
 * La notifica one-tap dell'Arrivo.
 *
 * L'Arrivo NON è un check-in: è l'invito a produrne uno. Ignorarla non
 * cancella nessuno — l'host vedrà comunque "arrivata, non confermata" e
 * potrà gestirla di persona. Il tap arricchisce la qualità, mai la
 * provenienza: la prova resta il codice raccolto dal beacon.
 */

export const ARRIVAL_CATEGORY = "wemeet-arrival";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function presentArrival(
  eventId: string,
  eventName: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Sei arrivato a ${eventName}`,
      body: "Tocca per confermare la presenza",
      data: { eventId, confirmationTap: true },
      categoryIdentifier: ARRIVAL_CATEGORY,
    },
    trigger: null, // subito
  });
}

/**
 * Il paracadute ottico, programmato all'ingresso nel cerchio GPS: parte solo
 * se nessun codice arriva via radio entro il ritardo (lib/arrival decide
 * quando armarlo e quando disinnescarlo). Non chiede nessuna conferma:
 * instrada sul canale ottico — inquadrare il QR, o il codice a mano.
 * Ritorna l'id con cui cancellarla, null se le notifiche sono negate.
 */
export async function scheduleOpticalFallback(
  eventId: string,
  eventName: string,
  delaySeconds: number,
): Promise<string | null> {
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `Sei nei paraggi di ${eventName}`,
        body: "Non ti abbiamo ancora sentito: quando entri, inquadra il QR di chi conduce l'evento.",
        data: { eventId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delaySeconds,
        repeats: false,
      },
    });
  } catch {
    return null; // permessi negati: il canale ottico resta, aprendo l'app
  }
}

export async function cancelOpticalFallback(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}

/**
 * Il tap sulla notifica di conferma. Ritorna l'evento a cui si riferisce,
 * così l'app può registrare il segnale nel borsellino e consegnarlo.
 *
 * Solo la notifica di conferma: il tap sul paracadute ottico apre l'app e
 * basta — toccare un «sei nei paraggi» non dichiara nessuna presenza.
 */
export function onArrivalTapped(
  handler: (eventId: string) => void,
): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as {
      eventId?: string;
      confirmationTap?: boolean;
    };
    if (data?.eventId && data.confirmationTap) handler(data.eventId);
  });
}
