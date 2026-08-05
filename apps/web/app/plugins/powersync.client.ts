import { createPowerSyncPlugin } from "@powersync/vue";
import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "../powersync/AppSchema";
import { WalletConnector } from "../powersync/connector";

export default defineNuxtPlugin((nuxtApp) => {
  const apiBase = useRuntimeConfig().public.apiBase;

  const db = new PowerSyncDatabase({
    database: {
      dbFilename: "attendee-arrival.db",
      // Niente worker: Vite 8 (oxc) non riesce a trasformare il worker di
      // @powersync/web quando il tipo non è staticamente noto
      // (worker.js?worker_file&type=ignore → parse error come script
      // classico) e il borsellino muore in dev. Sul main thread si perde il
      // multi-tab e un po' di fluidità: per un borsellino di poche righe non
      // si vede.
      enableMultiTabs: false,
      useWebWorker: false,
    },
    schema: AppSchema,
  });

  db.connect(new WalletConnector(apiBase));

  nuxtApp.vueApp.use(createPowerSyncPlugin({ database: db }));
});
