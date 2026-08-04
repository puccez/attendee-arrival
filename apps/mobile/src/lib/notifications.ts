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
 * Il tap sulla notifica. Ritorna l'evento a cui si riferisce, così l'app
 * può registrare il segnale nel borsellino e consegnarlo.
 */
export function onArrivalTapped(
  handler: (eventId: string) => void,
): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as {
      eventId?: string;
    };
    if (data?.eventId) handler(data.eventId);
  });
}
