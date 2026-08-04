import { register } from "node:module";

/**
 * Node risolve gli import ESM alla lettera; Metro (il bundler di React
 * Native) aggiunge le estensioni da sé. Questo hook insegna a node la
 * stessa cortesia, così i moduli puri dell'app si possono testare con
 * `node --test` senza device, senza emulatore e senza bundler — e senza
 * sporcare gli import dell'app con estensioni che nessuno scrive in RN.
 */
register("./ts-resolver-hooks.mjs", import.meta.url);
