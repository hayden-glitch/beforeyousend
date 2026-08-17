import { lazy, Suspense, useEffect } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import type { ReactNode } from "react";
import appCss from "~/styles/app.css?url";
import { DeferredMount } from "~/components/DeferredMount";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import {
  GOOGLE_ADS_ID,
  GOOGLE_TAG_BOOTSTRAP,
  hasSensitiveQuery,
  initAnalytics,
  initRouteTracking,
  type AnalyticsConfig,
} from "~/lib/analytics";
import { clearReloadGuard } from "~/lib/reloadGuard";
import { useCheckoutIntentResumer } from "~/lib/checkout";

const getAnalyticsConfig = createServerFn().handler(async () => {
  const cfg: AnalyticsConfig = {};
  const pick = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  cfg.tiktokPixelId = pick(process.env.TIKTOK_PIXEL_ID);
  // Codex final-fold Blocker 1 (comment 5300270649): while the request URL
  // carries a sensitive app query (token/session_id/gift code/auth or reset
  // secrets/raw next/…), SSR must OMIT the Google tag loader + bootstrap —
  // the page consumes the credential and scrubs the URL client-side BEFORE
  // measurement initializes on the clean URL (TikTok is client-only and is
  // deferred by initAnalytics for the same pages). getRequestUrl() is the
  // incoming page URL during SSR (AsyncLocalStorage request context); outside
  // a request context (client RPC re-fetch) it throws → not sensitive → the
  // tags render exactly as before. Same allowlist as the client page-view
  // guard (hasSensitiveQuery), so SSR and client always agree on "dirty".
  try {
    cfg.sensitive = hasSensitiveQuery(getRequestUrl().search);
  } catch {
    cfg.sensitive = false;
  }
  return cfg;
});

// The canonical Google tag bootstrap lives in src/lib/analytics.ts
// (GOOGLE_TAG_BOOTSTRAP) — shared with injectGoogleTagIfNeeded() so the
// sensitive-query pages can re-initialize measurement on the clean URL after
// the route scrubs the credential.

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        title:
          "Before You Send — Review your message before you send it",
      },
      {
        name: "description",
        content:
          "Paste the text you're about to send to your co-parent. Before You Send reviews how it may be received, flags conflict risks, and returns three calm, child-focused rewrites — free, no account needed.",
      },
      { name: "theme-color", content: "#0D110F" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon-bys.svg" },
    ],
    // Co-Parent Check-In A/B group: assign bys_checkin (on|off, default 25%)
    // BEFORE first paint so no flash of the pill for off-group visitors. Sets
    // data-checkin-group on <html>; the component reads it synchronously.
    // Idempotent — never touches the hero-variant script or its cookie.
    scripts: [
      {
        tag: "script",
        children: `(function(){try{var c=document.cookie.match(/(?:^|;\\s*)bys_checkin=([^;]+)/);var v=(c&&(c[1]==="on"||c[1]==="off"))?c[1]:(Math.random()<${Number(import.meta.env.VITE_CHECKIN_PCT || 0.25)}?"on":"off");if(!c)document.cookie="bys_checkin="+v+"; Max-Age=31536000; Path=/; SameSite=Lax";document.documentElement.setAttribute("data-checkin-group",v);}catch(e){}})();`,
      },
      // The Organizer promo (100% since 2026-08-12 D3 — every free dad sees
      // the trial; cookie kept as a stable key, always "on"). IDEMPOTENT copy
      // of the index.tsx script: reads the cookie first, so whichever page
      // loads first (/, /login, or /home) assigns once and the other reuses
      // it. Needed on __root because ads land on /login and the promo card
      // lives on /home — a visitor who never hits / would otherwise never be
      // assigned. Stale "off" cookies from the 25% era are overridden.
      {
        tag: "script",
        children: `(function(){try{document.cookie="bys_org_trial=on; Max-Age=31536000; Path=/; SameSite=Lax";document.documentElement.setAttribute("data-organizer-promo","on");}catch(e){}})();`,
      },
      // Theme (5304729186 §1): the site is ONE calm dark system — the legacy
      // bys_theme value (forest|midnight|sand) is ignored; there is no light
      // theme to restore, so data-theme is always set to the dark system and
      // the theme-color meta is pinned to the page charcoal. Kept as a
      // no-op attribute so the legacy ThemeSwitcher never FOUCs.
      {
        tag: "script",
        children: `(function(){try{document.documentElement.setAttribute("data-theme","forest");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#0D110F")}catch(e){}})();`,
      },
    ],
  }),
  loader: () => getAnalyticsConfig(),
  notFoundComponent: NotFoundPage,
  component: RootComponent,
});
function NotFoundPage() {
  // The 404 is rendered by the root route's notFoundComponent, so it inherits
  // the root head. Give it its own calm title/meta (consistent with the other
  // per-page titles) once mounted; the next navigation re-emits that page's
  // head, overwriting this.
  useEffect(() => {
    document.title = "Page not found — Before You Send";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        "content",
        "That page doesn't exist on Before You Send. Your draft is safe — head back to review a message or see the plans."
      );
    }
  }, []);
  return (
    <div className="min-h-dvh">
      <SiteHeader active="other" />
      <main id="main" tabIndex={-1} className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-start justify-center px-5 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Page not found</p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-forest sm:text-5xl">That page doesn't exist.</h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-stone">It may have moved, or the link may be mistyped. Your draft is safe either way.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href="/" className="btn-primary w-full text-center sm:w-auto">Back to the review</a>
          <a href="/pricing" className="btn-ghost w-full text-center sm:w-auto">See plans &amp; pricing</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function RootComponent() {
  const cfg = Route.useLoaderData();
  const router = useRouter();
  // Checkout-intent resumer: after a signed-out tap → /login?next= → sign-in
  // round-trip, this re-runs the parked purchase intent exactly once on
  // whatever surface the visitor lands (covers SPA + hard navigations on
  // every route). No-op unless a finite intent is parked and auth resolves
  // signed-in; errors surface via bys:checkout-error on the landing page.
  useCheckoutIntentResumer();
  useEffect(() => {
    // Successful mount → clear the stale-chunk reload guard, so a LATER
    // deploy in this tab session can still self-heal once (see reloadGuard.ts).
    clearReloadGuard();
    void initAnalytics(cfg);
    const stopRouteTracking = initRouteTracking(router);
    return () => {
      stopRouteTracking();
    };
  }, [cfg, router]);
  return (
    <RootDocument omitPixels={!!cfg?.sensitive}>
      <Outlet />
      {/* Conversion surfaces (SpecialOffer / TrialModal / CoParentCheckIn /
          GuidedFunnel) mount client-side only, and all render null until
          opened by their own state. They are lazy + deferred to the
          visitor's FIRST interaction (or a 6 s cap) so their code and
          effect/timer setup stay out of the anonymous landing path's
          initial-load main thread AND out of the post-paint measurement
          window while a visitor is only reading. */}
      <DeferredMount trigger="interaction" capMs={6000}>
        <Suspense fallback={null}>
          <SpecialOffer />
          <TrialModal />
          <CoParentCheckIn />
          <GuidedFunnel />
        </Suspense>
      </DeferredMount>
    </RootDocument>
  );
}
// Lazy conversion surfaces — each is its own chunk, fetched only after idle
// (see DeferredMount above). Keeps the initial bundle small and the main
// thread quiet during the measured load window.
const SpecialOffer = lazy(() => import("~/components/SpecialOffer"));
const TrialModal = lazy(() => import("~/components/TrialModal"));
const CoParentCheckIn = lazy(() => import("~/components/CoParentCheckIn"));
const GuidedFunnel = lazy(() => import("~/components/GuidedFunnel"));

function RootDocument({ children, omitPixels }: { children: ReactNode; omitPixels?: boolean }) {
  return (
    <html lang="en">
      <head>
        <meta name="referrer" content="strict-origin" />
        {/* Codex final-fold Blocker 1: while a sensitive app query (token/
            session_id/code/next/…) is the active document URL, SSR must not
            emit the third-party Google loader/bootstrap — the route consumes
            the credential and scrubs the URL, then flushDeferredPixels()
            initializes measurement on the clean URL. */}
        {!omitPixels && (
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`} />
        )}
        {!omitPixels && (
          <script dangerouslySetInnerHTML={{ __html: GOOGLE_TAG_BOOTSTRAP }} />
        )}
        <HeadContent />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
