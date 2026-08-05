<script setup lang="ts">
const route = useRoute();

/**
 * Due sistemi, non due temi (docs/design.md §1).
 *
 * WeMeet sul web è bianco, squadrato, a colonna: un catalogo. L'app è sabbia,
 * morbida, a tutta larghezza: un posto dove si incontrano persone. Sono
 * davvero diversi, e la vista attendee è l'unica nostra superficie che deve
 * girare da telefono — quindi è l'unica che segue l'app. Console e sandbox
 * restano strumenti da scrivania.
 */
const onPhone = computed(() => route.path.startsWith("/attendee/"));
useHead({
  bodyAttrs: { class: computed(() => (onPhone.value ? "sand" : "")) },
});
</script>

<template>
  <div :class="onPhone ? 'phone' : 'desk'">
    <NuxtPage />
  </div>
</template>

<style>
:root {
  /* Brand — identico fra web e app, campionato da entrambi. Corallo, non
     arancione: tira al rosa. Rosso vuol dire "ci si clicca". */
  --brand: #ff4758;
  --brand-soft: #ffa2aa;
  --brand-tint: rgba(255, 71, 88, 0.08);

  /* Superfici */
  --surface: #ffffff;
  --surface-sunken: #f5f5f5;
  --sand: #f6f3ef;
  --sand-deep: #efe9e2;
  --line: #e5e5e5;

  /* Inchiostri — scala neutral di Tailwind, la stessa che usano loro */
  --ink: #171717;
  --ink-strong: #262626;
  --body: #404040;
  --muted: #525252;
  --faint: #a3a3a3;

  /* Accenti dell'app */
  --tile: #dfe8e9;
  --tag: #ddeff0;
  --tag-ink: #2d454c;
  --ok: #16a34a;
  --warn: #eab308;
  /* Rosso funzionale, distinto dal brand: il brand vuol dire "ci si clicca",
     questo vuol dire "è andata male". Serve solo alla sandbox. */
  --bad: #dc2626;

  --r-control: 6px;
  --r-card: 16px;
  --r-panel: 32px;
  --r-full: 9999px;

  /* Google Sans è proprietario: lo dichiariamo (chi ce l'ha lo vede giusto) e
     dietro mettiamo Figtree, aperta e con la stessa personalità. §3 */
  /* "Figtree Variable" è il nome che registra @fontsource-variable: senza
     quello il fallback non aggancia mai il file che abbiamo installato. */
  --font: "Google Sans", "Figtree Variable", Figtree, Inter, system-ui,
    sans-serif;

  /* Alias di compatibilità: le pagine non ancora ripulite continuano a girare */
  --bg: var(--surface);
  --panel: var(--surface);
  --accent: var(--brand);
  --accent-dim: var(--brand-tint);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100dvh;
  background: var(--surface);
  color: var(--body);
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* La sabbia dell'app deve arrivare fino ai bordi dello schermo, anche in
   overscroll: per questo tinge il body e non solo il contenitore. */
body.sand {
  background: var(--sand-deep);
  color: var(--ink-strong);
}

.desk {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}

.phone {
  max-width: 430px;
  margin: 0 auto;
  min-height: 100dvh;
  background: linear-gradient(180deg, var(--sand-deep) 0%, var(--sand) 220px);
}

/* --- tipografia: interlinea 1.0 sui titoli, mai spaziatura fra lettere --- */
h1 {
  font-size: 36px;
  line-height: 40px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 8px;
}
h2 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  color: var(--ink-strong);
  margin: 0 0 8px;
}
a {
  color: var(--brand);
}
.eyebrow {
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--brand);
}
.muted {
  color: var(--muted);
}
.faint {
  color: var(--faint);
}

/* --- superfici del web: si separano con bordo e raggio, mai con un'ombra --- */
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  padding: 16px;
  margin-top: 16px;
}

button {
  font: inherit;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  background: var(--brand);
  color: #fff;
  border: 0;
  border-radius: var(--r-control);
  padding: 0 16px;
  height: 48px;
}
button.secondary {
  background: var(--surface);
  color: var(--body);
  border: 1px solid var(--line);
}
button:disabled {
  background: var(--brand-soft);
  cursor: default;
}
button.secondary:disabled {
  background: var(--surface);
  color: var(--faint);
}

input {
  font: inherit;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  background: var(--surface);
  color: var(--ink-strong);
  width: 100%;
}
input[type="checkbox"] {
  accent-color: var(--brand);
}
input:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -1px;
}
label {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  display: block;
  margin-bottom: 4px;
  color: var(--body);
}

.row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: end;
}
.row > div {
  flex: 1;
  min-width: 180px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  text-align: left;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 8px;
  border-bottom: 1px solid var(--line);
}
td {
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
  color: var(--ink-strong);
}

/* Pastiglia: raggio 6px sul web, completamente arrotondata nell'app */
.badge {
  display: inline-block;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  border-radius: var(--r-control);
  padding: 4px 8px;
  border: 1px solid var(--line);
  color: var(--ink-strong);
}
.badge.machine {
  color: var(--ok);
  border-color: var(--ok);
}
.badge.human {
  color: #8a6d0b;
  border-color: var(--warn);
}
.badge.both {
  color: #fff;
  background: var(--ok);
  border-color: var(--ok);
}
.badge.none {
  color: var(--muted);
}

.code-digits {
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.2em;
  font-size: 34px;
  font-weight: 600;
  color: var(--brand);
}

.notice {
  border-left: 3px solid var(--brand);
  background: var(--brand-tint);
  padding: 12px 16px;
  border-radius: 0 var(--r-control) var(--r-control) 0;
  margin-top: 12px;
  color: var(--ink-strong);
}
/* La sandbox è un laboratorio: un esito si deve leggere prima di leggerlo.
   Verde = il sistema ha tenuto, rosso = l'attacco è passato. */
.notice.held {
  border-left-color: var(--ok);
  background: rgba(22, 163, 74, 0.07);
}
.notice.broke {
  border-left-color: var(--bad);
  background: rgba(220, 38, 38, 0.07);
}
</style>
