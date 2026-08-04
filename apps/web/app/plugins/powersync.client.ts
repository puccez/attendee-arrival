import { createPowerSyncPlugin } from "@powersync/vue";
import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "../powersync/AppSchema";
import { WalletConnector } from "../powersync/connector";

export default defineNuxtPlugin((nuxtApp) => {
  const apiBase = useRuntimeConfig().public.apiBase;

  const db = new PowerSyncDatabase({
    database: { dbFilename: "attendee-arrival.db" },
    schema: AppSchema,
  });

  db.connect(new WalletConnector(apiBase));

  nuxtApp.vueApp.use(createPowerSyncPlugin({ database: db }));
});
