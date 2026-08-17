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
    // P0 login fix (2026-08-17): bound the /me fetch — a stalled connection
    // must resolve "not signed in" in 8s, never leave the header/auth state
    // hanging (safe default: the header just keeps showing Sign in).
    siteAuthInFlight = fetch("/api/auth/me", { signal: AbortSignal.timeout(8000) })
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
  // Lightweight header (spec §5 / comp A): hairline bar, 58px tall, brand
  // ALWAYS visible — the B·Y·S logo shows at 320/375/390/393/430 (wordmark
  // text removed 2026-08-16 per owner — the logo is the brand; it stays
  // tappable Home on every page). Public nav stays tiny: logo · Pricing · Sign in.
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-cream">
      <div className="mx-auto flex h-[58px] max-w-[1180px] items-center justify-between gap-2 px-4 sm:px-6">
        <a
          href="/"
          aria-label="Before You Send home"
          className="-m-1 flex min-h-11 shrink-0 items-center gap-2 rounded-lg p-1 transition-colors duration-150 hover:text-forest max-[370px]:gap-1.5"
        >
          <img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7 max-[370px]:h-6 max-[370px]:w-6" />
        </a>
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <nav aria-label="Main" className="flex items-center">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={t.href}
                aria-current={active === t.id ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium transition-colors duration-150 max-[370px]:px-2 ${
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
              className="inline-flex min-h-11 shrink-0 items-center rounded-[10px] border border-line bg-card px-4 text-sm font-medium text-ink transition-colors duration-150 hover:border-forest/40 hover:text-forest max-[370px]:px-2.5"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

// Footer (owner UI cleanup 2026-08-16): benchmarked against Apple / Microsoft /
// Stripe / polished subscription products — 3 quiet link groups (Product /
// Company / Legal), account actions OUT of the public footer (Log out lives in
// the profile menu; Sign in stays for signed-out visitors as a quiet Product
// link), one short legal disclaimer visually separated below the groups, and a
// clean 2-column mobile stack. Same premium dark system as the header.
function FooterGroup({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-taupe">{title}</p>
      <ul className="mt-2 space-y-0.5">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="inline-flex min-h-11 items-center text-base text-stone transition-colors hover:text-ink">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  const signedIn = !!useSiteAuth()?.user;
  const productLinks = signedIn
    ? [
        { label: "Pricing", href: "/pricing" },
        { label: "Command Center", href: "/home" },
        { label: "Consultations", href: "/consultations" },
      ]
    : [
        { label: "Pricing", href: "/pricing" },
        { label: "Consultations", href: "/consultations" },
        { label: "Sign in", href: "/login" },
      ];
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:max-w-xl">
          <FooterGroup title="Product" links={productLinks} />
          <FooterGroup
            title="Company"
            links={[
              { label: "About", href: "/about" },
              { label: "FAQ", href: "/faq" },
              { label: "Contact", href: "/contact" },
            ]}
          />
          <FooterGroup
            title="Legal"
            links={[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
            ]}
          />
        </div>
        <div className="mt-8 border-t border-line/70 pt-5">
          <p className="max-w-2xl text-sm leading-relaxed text-taupe">
            Before You Send is not a law firm and does not provide legal advice. Reviews are AI-assisted
            communication guidance.
          </p>
          <p className="mt-2 text-sm text-taupe">© {new Date().getFullYear()} Before You Send</p>
        </div>
      </div>
    </footer>
  );
}
