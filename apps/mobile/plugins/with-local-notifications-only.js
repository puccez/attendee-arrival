const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

/**
 * L'app attendee usa solo notifiche **locali**: l'invito one-tap nasce dal
 * telefono stesso quando sente il beacon o attraversa il geofence, non da
 * un server. Nessuna push remota, in nessun punto del flusso.
 *
 * Il config plugin di expo-notifications però aggiunge comunque
 * l'entitlement `aps-environment`, che **richiede l'abbonamento a
 * pagamento** all'Apple Developer Program: con un Apple ID gratuito la
 * firma fallisce con "Personal development teams do not support the Push
 * Notifications capability". Per questo quel plugin non è registrato in
 * `app.json` — la libreria expo-notifications continua a funzionare per
 * le notifiche locali, che è tutto ciò che ci serve; si perde solo la
 * personalizzazione dell'icona/colore su Android.
 *
 * Questo plugin resta come rete di sicurezza: se un giorno qualcosa
 * rimettesse l'entitlement, qui viene tolto.
 *
 * Toglierli non leva niente all'app e la rende installabile da chiunque
 * abbia un Apple ID — cioè da chi valuta la demo, senza chiedergli 99
 * dollari. Se un giorno servisse la silent push per campionare il dwell,
 * si rimette questo plugin fra parentesi e si compra la membership.
 */
module.exports = function withLocalNotificationsOnly(config) {
  config = withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    return modConfig;
  });

  config = withInfoPlist(config, (modConfig) => {
    const modes = modConfig.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      // `location` e `bluetooth-central` restano: sono il canale radio.
      modConfig.modResults.UIBackgroundModes = modes.filter(
        (mode) => mode !== "remote-notification",
      );
    }
    return modConfig;
  });

  return config;
};
