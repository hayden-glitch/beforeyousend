// check:ssr — post-build SSR smoke (Codex 2f9bf78 intent).
//
// Calls the BUILT TanStack server (dist/server/server.js — the same portable
// fetch handler serve.ts wraps) for every public route and FAILS on:
//   - non-2xx responses,
//   - SSR recovery markers (data-dgst, $RX/$RC — React's "server couldn't
//     finish, switching to client" stream markers),
//   - `window/document is not defined` / ReferenceError in the HTML,
//   - /confirm missing its "Confirming your account" markup (the known
//     regression: render-time window.location.search read crashed the SSR
//     stream and produced an empty error boundary).
//
// Run AFTER `bun run build` (the deploy gate runs it after build-vercel.sh):
//   bun run check:ssr
// .mjs on purpose — excluded from tsconfig's **/*.ts include so a fresh
// checkout (no dist/ yet) keeps `tsc --noEmit` green; bun runs it natively.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SERVER = resolve(import.meta.dirname, "../dist/server/server.js");
if (!existsSync(SERVER)) {
  console.error("check:ssr FAIL — " + SERVER + " not found. Run `bun run build` first.");
  process.exit(1);
}

const { default: handler } = await import(SERVER);
const fetchHandler = handler.fetch ?? handler;

// 14 public routes + /confirm?token= — every route a visitor (or the owner's
// ad traffic) can land on must SSR cleanly.
const ROUTES = [
  "/",
  "/pricing",
  "/login",
  "/faq",
  "/about",
  "/privacy",
  "/terms",
  "/contact",
  "/trust",
  "/redeem",
  "/consultations",
  "/quiz",
  "/verification",
  "/confirm?token=abc123",
];

// React streaming-SSR recovery markers + classic SSR crash lines.
const RECOVERY = /data-dgst|\$R[XC]|window is not defined|document is not defined|ReferenceError/i;

let failed = 0;
for (const route of ROUTES) {
  let res;
  try {
    res = await fetchHandler(new Request(`http://check-ssr.local${route}`));
  } catch (err) {
    console.error(`FAIL ${route} — handler threw: ${err?.message ?? err}`);
    failed++;
    continue;
  }
  const html = typeof res.text === "function" ? await res.text() : String(res);
  const okStatus = typeof res.status === "number" && res.status >= 200 && res.status < 300;
  const marker = RECOVERY.test(html);
  const ok = okStatus && !marker;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${typeof res.status === "number" ? res.status : "?"} ${route}${marker ? "  <-- SSR recovery marker present" : ""}`);
  if (route.startsWith("/confirm")) {
    const hasMarkup = html.includes("Confirming your account");
    if (!hasMarkup) {
      failed++;
      console.log(`     MISSING "Confirming your account" markup`);
    } else {
      console.log(`     contains "Confirming your account" ✓`);
    }
  }
}

if (failed > 0) {
  console.error(`\ncheck:ssr FAILED — ${failed} route(s) broken.`);
  process.exit(1);
}
console.log(`\ncheck:ssr PASS — ${ROUTES.length} routes SSR-clean, no recovery markers.`);
