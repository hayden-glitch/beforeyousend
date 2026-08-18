import { createRouter } from "@tanstack/react-router";

import { RouteErrorFallback } from "./components/RouteErrorFallback";
import { installStaleChunkRecovery } from "./lib/reloadGuard";
import { routeTree } from "./routeTree.gen";

// Stale-chunk self-healing (P1, 2026-08-16): module scope runs in the browser
// entry at the earliest moment (and during SSR, where it no-ops) — a tab
// holding a previous deploy that hits a retired chunk reloads ONCE instead of
// dead-ending. See src/lib/reloadGuard.ts.
installStaleChunkRecovery();

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: () => <p>Not found</p>,
    // Calm router-level error fallback — renders when a page fails after the
    // one-time auto-reload was already attempted.
    defaultErrorComponent: RouteErrorFallback,
  });
}
