export default defineNuxtConfig({
  compatibilityDate: "2026-08-04",
  devtools: { enabled: false },
  ssr: false, // demo interattiva: fotocamera, GPS, localStorage — tutto client
  // Google Sans, il carattere di WeRoad, è proprietario: non lo ridistribuiamo.
  // Figtree è aperta (OFL) e ha la stessa personalità geometrica-umanista, così
  // la demo somiglia al brand senza spedire un font che non è nostro.
  // docs/design.md §3.
  css: ["@fontsource-variable/figtree"],
  devServer: {
    host: "0.0.0.0",
    port: 3000,
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "http://localhost:3001",
    },
  },
  vite: {
    optimizeDeps: {
      exclude: ["@powersync/web"],
    },
    worker: {
      format: "es",
    },
  },
});
