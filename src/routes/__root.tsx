import { useEffect } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import appCss from "~/styles/app.css?url";
import SpecialOffer from "~/components/SpecialOffer";
import TrialModal from "~/components/TrialModal";
import CoParentCheckIn from "~/components/CoParentCheckIn";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import {
  initAnalytics,
  initRouteTracking,
  type AnalyticsConfig,
} from "~/lib/analytics";

const getAnalyticsConfig = createServerFn().handler(async () => {
  const cfg: AnalyticsConfig = {};
  const pick = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  cfg.tiktokPixelId = pick(process.env.TIKTOK_PIXEL_ID);
  cfg.googleAdsId = pick(process.env.GOOGLE_ADS_ID);
  return cfg;
});

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
      { name: "theme-color", content: "#FAF7F1" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon-bys.svg" },
      {
        rel: "preload",
        href: "/fonts/fraunces-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
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
      // Theme (app-redesign-spec §1.3): apply the saved theme BEFORE first paint
      // so there is no flash — sets data-theme on <html> + the theme-color meta.
      // Falls back to Forest (current brand) with no saved value / JS off.
      // localStorage is origin-scoped, so apex ↔ www don't share the theme —
      // acceptable for a theme; cookie-keying is not needed here.
      {
        tag: "script",
        children: `(function(){try{var t="forest";try{var s=localStorage.getItem("bys_theme");if(s==="forest"||s==="midnight"||s==="sand")t=s}catch(e){}document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m){var c={forest:"#FAF7F1",midnight:"#0e1a15",sand:"#f6f1e6"}[t];if(c)m.setAttribute("content",c)}}catch(e){}})();`,
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
  useEffect(() => {
    void initAnalytics(cfg);
    const stopRouteTracking = initRouteTracking(router);
    return () => {
      stopRouteTracking();
    };
  }, [cfg, router]);
  return (
    <RootDocument>
      <Outlet />
      <SpecialOffer />
      <TrialModal />
      <CoParentCheckIn />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
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
