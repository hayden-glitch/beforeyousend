// Shared site chrome (front-end polish pass): the sleek sticky header with the
// text-first nav + Sign in, and the landing footer. Used on the public pages —
// landing (/), pricing, consultations, the trust pages (faq/about/privacy/
// terms/contact), and the 404. App pages (home, dashboard, owner) and funnel
// pages (login, redeem, confirm, onboarding) keep their own chrome — do not
// use this there.
//
// Design language: ONE calm dark system (5304729186 §1) — bone type on a
// near-black canvas, quiet low-contrast borders, text-first nav with a
// subtle rule for the selected state (no filled pills), min-h-11 touch
// targets, mobile-first 390px.
//
// Owner-batch DESIGN 2 (2026-08-12): the header tabs narrow to exactly one —
// Pricing (the logo IS Home; the old Home tab is deleted). Consultations +
// FAQ moved to the FOOTER links. Signed-in visitors see the avatar user menu
// (UserMenu) instead of the "Command Center →" + "Log out" pair — the menu's
// Profile & account entry and header row cover the Command Center destination.

import { useEffect, useState } from "react";
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
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-5 sm:px-6 max-[400px]:px-4">
        <a href="/" className="flex shrink-0 items-center gap-2 font-display text-[1.3rem] font-semibold tracking-tight text-ink -m-2 p-2">
          <img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-8 w-8 max-[400px]:h-7 max-[400px]:w-7" />
          <span className="hidden min-[480px]:inline">Before You Send</span>
          <span className="hidden min-[480px]:inline text-stone">.</span>
        </a>
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <nav aria-label="Main" className="flex items-center">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={t.href}
                aria-current={active === t.id ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium transition-colors duration-150 max-[400px]:px-2 ${
                  active === t.id ? "text-ink" : "text-stone hover:text-ink"
                }`}
              >
                {t.label}
                {active === t.id && <span aria-hidden="true" className="absolute inset-x-3 bottom-0.5 h-px bg-forest" />}
              </a>
            ))}
          </nav>
          {signedIn ? (
            <UserMenu user={auth!.user} tier={tier} context="header" />
          ) : (
            <a
              href="/login"
              className="inline-flex min-h-11 shrink-0 items-center rounded-[10px] border border-line bg-card px-4 text-sm font-medium text-ink transition-colors duration-150 hover:border-forest/40 hover:text-forest max-[480px]:px-3"
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
        <nav aria-label="Footer" className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-base text-stone">
          {FOOTER_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="inline-flex min-h-11 items-center transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
          {signedIn ? (
            <>
              <a key="command-center" href="/home" className="inline-flex min-h-11 items-center transition-colors hover:text-ink">
                Command Center
              </a>
              <button key="log-out" type="button" onClick={logoutFromChrome} className="inline-flex min-h-11 items-center transition-colors hover:text-ink">
                Log out
              </button>
            </>
          ) : (
            <a key="sign-in" href="/login" className="inline-flex min-h-11 items-center transition-colors hover:text-ink">
              Sign in
            </a>
          )}
        </nav>
        <p className="mt-4 text-base leading-relaxed text-stone">
          Before You Send is not a law firm and does not provide legal advice. Reviews are AI-assisted communication guidance only, and your draft is processed by AI to produce them.
        </p>
        <p className="mt-4 text-taupe">© {new Date().getFullYear()} Before You Send</p>
      </div>
    </footer>
  );
}
