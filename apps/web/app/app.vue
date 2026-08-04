<template>
  <div class="shell">
    <NuxtPage />
  </div>
</template>

<style>
:root {
  --bg: #fbfaf8;
  --panel: #ffffff;
  --ink: #20272b;
  --muted: #64707a;
  --line: #e2e0db;
  --accent: #e1502e;
  --accent-dim: rgba(225, 80, 46, 0.09);
  --ok: #1e7a55;
  --warn: #b3831a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
.shell { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 18px; margin: 0 0 8px; }
.eyebrow {
  font-size: 12px; font-weight: 600; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--accent);
}
.muted { color: var(--muted); }
.panel {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 12px; padding: 20px; margin-top: 16px;
}
button {
  font: inherit; font-weight: 600; cursor: pointer;
  background: var(--accent); color: #fff; border: 0;
  border-radius: 8px; padding: 10px 18px;
}
button.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
button:disabled { opacity: 0.5; cursor: default; }
input {
  font: inherit; padding: 9px 12px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--bg); color: var(--ink); width: 100%;
}
label { font-size: 13px; font-weight: 600; display: block; margin-bottom: 4px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
.row > div { flex: 1; min-width: 180px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.badge {
  display: inline-block; font-size: 12px; font-weight: 600;
  border-radius: 999px; padding: 2px 10px; border: 1px solid var(--line);
}
.badge.machine { color: var(--ok); border-color: var(--ok); }
.badge.human { color: var(--warn); border-color: var(--warn); }
.badge.both { color: #fff; background: var(--ok); border-color: var(--ok); }
.badge.none { color: var(--muted); }
.code-digits {
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums; letter-spacing: 0.2em;
  font-size: 34px; font-weight: 600; color: var(--accent);
}
.notice {
  border-left: 3px solid var(--accent); background: var(--accent-dim);
  padding: 12px 16px; border-radius: 0 8px 8px 0; margin-top: 12px;
}
</style>
