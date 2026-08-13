// Shared site chrome (front-end polish pass): the sleek sticky header with the
// pill tab group + Sign in, and the landing footer. Used on the public pages —
// landing (/), pricing, consultations, the trust pages (faq/about/privacy/
// terms/contact), and the 404. App pages (home, dashboard, owner) and funnel
// pages (login, redeem, confirm, onboarding) keep their own chrome — do not
// use this there.
//
// Design language: forest/cream, rounded-full pills, min-h-11 touch targets,
// calm copy, mobile-first 390px.
//
// Owner-batch DESIGN 2 (2026-08-12): the header tabs narrow to exactly one —
// Pricing (the logo IS Home; the old Home tab is deleted). Consultations +
// FAQ moved to the FOOTER links. Signed-in visitors see the avatar user menu
// (UserMenu) instead of the "Command Center →" + "Log out" pair — the menu's
// Profile & account entry and header row cover the Command Center destination.

import { useEffect, useRef, useState } from "react";
import ThemeSwitcher from "~/components/ThemeSwitcher";
import UserMenu from "~/components/UserMenu";

// Auth-aware chrome (C1, owner's auto-logout report 75fa1a07): the header and
// footer must know whether the visitor is signed in — a signed-in dad who
// clicks the logo back to the landing used to always see "Sign in" and look
// logged out. One /api/auth/me fetch per mount, deduped module-wide and
// cached ~2 min so the shared layout never re-fires it on nav; while the
// check is pending we keep showing the default "Sign in" (no flash of a
// different state). 5xx / network failures resolve to NOT signed in (safe
// default — never block landing nav on an auth hiccup). DESIGN 2: the full
// user + quota are cached so the header can render the avatar menu (name,
// email, plan, stripe customer id) without a second fetch.
type SiteAuth = { user: any | null; quota: any | null };
let siteAuthCache: { at: number; value: SiteAuth } | null = null;
let siteAuthInFlight: Promise<SiteAuth> | null = null;
const SITE_AUTH_TTL_MS = 120000;
function checkSiteAuth(): Promise<SiteAuth> {
  const now = Date.now();
  if (siteAuthCache && now - siteAuthCache.at < SITE_AUTH_TTL_MS) return Promise.resolve(siteAuthCache.value);
  if (!siteAuthInFlight) {
    siteAuthInFlight = fetch("/api/auth/me")
      .then(async (r) => {
        if (r.status === 401) {
          const j = await r.json().catch(() => ({ user: null }));
          return { user: j && j.user ? j.user : null, quota: null };
        }
        if (!r.ok) return { user: null, quota: null };
        const j = await r.json().catch(() => ({ user: null }));
        return { user: j && j.user ? j.user : null, quota: j && j.quota ? j.quota : null };
      })
      .catch(() => ({ user: null, quota: null }))
      .then((v) => {
        siteAuthCache = { at: Date.now(), value: v };
        siteAuthInFlight = null;
        return v;
      });
  }
  return siteAuthInFlight;
}
function useSiteAuth(): SiteAuth | null {
  const [auth, setAuth] = useState<SiteAuth | null>(null);
  useEffect(() => {
    let mounted = true;
    checkSiteAuth().then((v) => { if (mounted) setAuth(v); });
    return () => { mounted = false; };
  }, []);
  return auth;
}
async function logoutFromChrome() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* full reload below still lands on a logged-out landing */ }
  window.location.assign("/");
}

export type SiteTab = "home" | "pricing" | "consultations" | "faq" | "other";

// DESIGN 2: exactly one tab — Pricing. The logo is Home; Consultations + FAQ
// live in the footer links below.
const TABS: { id: Exclude<SiteTab, "other">; label: string; href: string }[] = [
  { id: "pricing", label: "Pricing", href: "/pricing" },
];

export function SiteHeader({ active = "other" }: { active?: SiteTab | string }) {
  const auth = useSiteAuth();
  const signedIn = !!auth?.user;
  const tier = auth?.quota?.tier || auth?.user?.profile?.tier || "free";
  // Landing-redesign F4: the tab pill scrolls on very narrow screens; a quiet
  // right-edge fade shows ONLY while it overflows, so "more tabs" is never a
  // hidden-scrollbar surprise. With the DESIGN 2 single tab it can never
  // overflow, but the machinery is kept so a future tab add re-arms it.
  const navRef = useRef<HTMLElement | null>(null);
  const fadeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    const fade = fadeRef.current;
    if (!nav || !fade) return;
    const update = () => {
      fade.style.opacity = nav.scrollWidth > nav.clientWidth + 1 ? "1" : "0";
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-5 sm:px-6 max-[400px]:px-4">
        <a href="/" className="flex shrink-0 items-center gap-2 font-display text-[1.35rem] font-semibold tracking-tight text-forest -m-2 p-2">
          <img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-8 w-8 max-[400px]:h-7 max-[400px]:w-7" />
          <span className="hidden min-[480px]:inline">Before You Send</span>
          <span className="hidden min-[480px]:inline text-forest-soft">.</span>
        </a>
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0">
            <nav
              ref={navRef}
              aria-label="Main"
              className="flex items-center gap-1 overflow-x-auto rounded-full border border-line bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {TABS.map((t) => (
                <a
                  key={t.id}
                  href={t.href}
                  aria-current={active === t.id ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-150 max-[480px]:px-3 max-[480px]:text-[13px] max-[400px]:px-2.5 ${
                    active === t.id ? "bg-forest text-cream" : "text-forest hover:bg-forest/5 hover:text-forest-deep"
                  }`}
                >
                  {t.label}
                </a>
              ))}
            </nav>
            <div
              ref={fadeRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1 right-0 w-6 rounded-r-full bg-gradient-to-l from-card to-transparent opacity-0 transition-opacity duration-200"
            />
          </div>
          {signedIn ? (
            <UserMenu user={auth!.user} tier={tier} context="header" />
          ) : (
            <a
              href="/login"
              className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-forest px-5 text-sm font-semibold text-cream transition-colors duration-150 hover:bg-forest-soft max-[480px]:px-3"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

// DESIGN 2: Consultations + FAQ move to the footer — About, Pricing,
// Consultations, Privacy, Terms, FAQ, Contact (+ the signed-in/out block).
const FOOTER_LINKS: { label: string; href: string }[] = [
  { label: "About", href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Consultations", href: "/consultations" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
];

export function SiteFooter() {
  const signedIn = !!useSiteAuth()?.user;
  return (
    <footer className="border-t border-line py-9">
      <div className="mx-auto max-w-3xl px-5 sm:px-6">
        <nav aria-label="Footer" className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-base text-forest">
          {FOOTER_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="inline-flex min-h-11 items-center transition-colors hover:text-forest-deep">
              {l.label}
            </a>
          ))}
          {signedIn ? (
            <>
              <a key="command-center" href="/home" className="inline-flex min-h-11 items-center transition-colors hover:text-forest-deep">
                Command Center
              </a>
              <button key="log-out" type="button" onClick={logoutFromChrome} className="inline-flex min-h-11 items-center transition-colors hover:text-forest-deep">
                Log out
              </button>
            </>
          ) : (
            <a key="sign-in" href="/login" className="inline-flex min-h-11 items-center transition-colors hover:text-forest-deep">
              Sign in
            </a>
          )}
        </nav>
        <div className="mt-6">
          <ThemeSwitcher variant="inline" />
        </div>
        <p className="mt-4 text-base leading-relaxed text-stone">
          Before You Send is not a law firm and does not provide legal advice. Reviews are AI-assisted communication guidance only, and your draft is processed by AI to produce them.
        </p>
        <p className="mt-4 text-taupe">© {new Date().getFullYear()} Before You Send</p>
      </div>
    </footer>
  );
}
