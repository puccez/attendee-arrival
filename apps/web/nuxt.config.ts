export default defineNuxtConfig({
  compatibilityDate: "2026-08-04",
  devtools: { enabled: false },
  ssr: false, // demo interattiva: fotocamera, GPS, localStorage — tutto client
  devServer: {
    host: "0.0.0.0",
    port: 3000,
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "http://localhost:3001",
    },
  },
});
