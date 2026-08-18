/**
 * Stale-chunk self-healing + bfcache self-heal (P1, 2026-08-17).
 *
 * A tab that loaded a previous deploy holds an index.html whose entry points
 * at chunks by hashed name. When a new deploy retires one of those chunks,
 * the tab's next dynamic import 404s on the live CDN:
 *   "Failed to fetch dynamically imported module" (Chromium)
 *   "Importing a module script failed" (Safari/Firefox)
 * …and the visitor dead-ends on a broken screen (owner hit this live
 * 2026-08-16: ReviewResults-hmomkyU2.js).
 *
 * Back-forward cache (bfcache): when a browser restores a tab from bfcache
 * (iOS Safari / any browser's Back/Forward), the JS heap is frozen at its
 * old state — old bundle, old chunk references — so buttons can die while
 * analytics still fire (owner hit this live 2026-08-17: his tab's entry
 * chunk had been retired by a deploy; clicks kept firing events but
 * navigation was dead). The `pageshow` listener below hard-reloads on any
 * bfcache restore (`event.persisted === true`) so the page is always served
 * from the current deploy.
 *
 * Recovery: on the first stale-import signal OR first bfcache restore, set
 * the sessionStorage guard and HARD reload — the reload must fetch the fresh
 * index.html (see Cache-Control below), whose entry references the current
 * chunks. If the failure recurs after that one reload (offline, or the index
 * still pointed at a retired chunk), the guard is already set: do NOT reload
 * again — the router's calm error fallback (RouteErrorFallback) renders
 * instead, so the page never loops. The guard is cleared on successful app
 * mount, so a LATER deploy in the same tab session can still self-heal
 * exactly once, and a later bfcache restore in the same session still
 * hard-reloads once.
 *
 * Cache-Control note: HTML responses are served with
 * `Cache-Control: public, max-age=0, must-revalidate` (Vercel platform
 * default for this project's function responses — verified live 2026-08-16;
 * .vercel/output/config.json only adds Referrer-Policy). The browser
 * therefore revalidates "/" on every load, which is what makes the reload
 * fetch the fresh index.html instead of the cached one.
 *
 * The installer is window-guarded and safe to call from module scope in
 * src/router.tsx, which runs in the browser entry at the earliest moment AND
 * during SSR (where it no-ops).
 */

export const RELOAD_GUARD_KEY = "bys:reload-guard";

const STALE_IMPORT_MESSAGE_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed/i;

function isStaleImportError(reason: unknown): boolean {
  if (!reason) return false;
  const message =
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? reason.message
        : String((reason as { message?: unknown }).message ?? reason);
  return STALE_IMPORT_MESSAGE_RE.test(message);
}

function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return; // already reloaded once — stop
    sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    // sessionStorage unavailable (private mode / blocked storage): still
    // reload — the guard is best-effort loop protection only.
  }
  window.location.reload();
}

/** Remove the guard after a successful mount so future deploys can heal once. */
export function clearReloadGuard() {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/**
 * Install the listeners that detect stale chunks (stale dynamic-import
 * failures) and stale bfcache restores. No-op outside a browser (SSR /
 * build). Safe to call more than once.
 */
export function installStaleChunkRecovery() {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  // bfcache restore: the JS heap is frozen at its old state (old bundle, old
  // chunk refs) — hard-reload so the page is served from the current deploy.
  // `persisted` lives on PageTransitionEvent; older Safari exposes it on
  // pageshow too, so type it explicitly and verify it at runtime.
  window.addEventListener("pageshow", (event: PageTransitionEvent) => {
    if (typeof event.persisted === "boolean" && event.persisted) reloadOnce();
  });
  // Vite fires `vite:preloadError` on window when a modulepreload fails
  // (https://vite.dev/guide/build#load-error-handling).
  window.addEventListener("vite:preloadError", reloadOnce);
  // Lazy imports without a preload fail as promise rejections instead.
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    if (isStaleImportError(event.reason)) reloadOnce();
  });
}
