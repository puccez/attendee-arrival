const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

/**
 * L'app attendee usa solo notifiche **locali**: l'invito one-tap nasce dal
 * telefono stesso quando sente il beacon o attraversa il geofence, non da
 * un server. Nessuna push remota, in nessun punto del flusso.
 *
 * Il config plugin di expo-notifications però aggiunge comunque
 * l'entitlement `aps-environment` e il background mode
 * `remote-notification`, e `aps-environment` **richiede l'abbonamento a
 * pagamento** all'Apple Developer Program: con un Apple ID gratuito la
 * firma fallisce con "Personal development teams do not support the Push
 * Notifications capability".
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
