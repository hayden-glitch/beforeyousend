// User menu (owner-batch DESIGN 2, 2026-08-12) — shared by the dashboard
// header (home.tsx) and the public SiteChrome header. Initials avatar +
// popover menu. Every entry is REAL: the plan row opens the Stripe billing
// portal ONLY when profile.stripeCustomerId exists (POST /api/portal 404s
// otherwise — verified server-api.ts L3170-3189); paid-without-customer,
// gifted, and free tiers route to /pricing; Export shows only for
// command/ultimate (real entitlement), other tiers get the honest "part of
// Command Center" teaser. No "change password" (no endpoint — handlePassword
// rejects existing-password users) and no delete-account in the menu (too
// heavy — it lives on /account). A11y: role=menu/menuitem, aria-haspopup/
// expanded/controls, roving focus (ArrowDown/ArrowUp/Home/End), Escape
// returns focus to the trigger, outside click + backdrop close, item tap
// closes. Reduced motion: opacity fade only (120ms — global reduced-motion
// rule zeroes it).

import { useCallback, useEffect, useRef, useState } from "react";
import ThemeSwitcher from "./ThemeSwitcher";
import { track } from "~/lib/analytics";
import { downloadRecord } from "~/lib/exportRecord";

export type UserMenuContext = "header" | "dashboard";

// Plan row copy — real prices (owner 2026-08-11 price cut, live on pricing).
const PLAN_PRICES: Record<string, string> = {
  steady: "Steady · $4.99/mo",
  command: "Command Center · $12.49/mo",
  ultimate: "Ultimate Co-Parent · $24.99/mo",
};

// §2.3 avatar fallback: first letter of first word + first letter of last
// word, uppercased ("Chris S." → "CS", "Chris" → "C"); fallback: first letter
// of the email; final fallback "B".
export function initialsAvatar(name?: string, email?: string): string {
  const n = (name || "").trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    const a = words[0]?.[0] || "";
    const b = words.length > 1 ? words[words.length - 1][0] || "" : "";
    return (a + b).toUpperCase();
  }
  const e = (email || "").trim();
  return e ? e[0].toUpperCase() : "B";
}

export default function UserMenu({
  user,
  tier,
  context,
}: {
  user: any;
  tier: string;
  context: UserMenuContext;
}) {
  const [open, setOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [menuNotice, setMenuNotice] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const profile = (user?.profile || {}) as Record<string, any>;
  const email = String(user?.email || "");
  const name = String(profile.name || "");
  const first = name.split(" ")[0] || email.split("@")[0] || "there";
  // Effective tier (userTier semantics) vs the PROFILE tier: a gifted month
  // lifts free→steady for entitlements, but the plan ROW must still say
  // "Gifted Steady through {date}" — profile.tier is the paid tier.
  const paidTier =
    profile.tier === "steady" ||
    profile.tier === "command" ||
    profile.tier === "ultimate";
  const hasCustomer = !!profile.stripeCustomerId;
  const suite = tier === "command" || tier === "ultimate";
  const gifted =
    !!profile.giftUntil && new Date(profile.giftUntil).getTime() > Date.now();

  const close = useCallback(() => {
    setOpen(false);
    setMenuNotice("");
  }, []);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    track("user_menu_open", { context });
    setOpen(true);
  };

  // Outside click + backdrop + Escape close; roving focus; Tab closes and
  // moves on. Focus moves to the first item on open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = e.target as Node | null;
      if (wrapRef.current && !wrapRef.current.contains(el)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        btnRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        const items = itemRefs.current.filter(Boolean) as HTMLElement[];
        if (!items.length) return;
        const cur = document.activeElement as HTMLElement | null;
        let idx = cur ? items.indexOf(cur) : -1;
        if (e.key === "ArrowDown") idx = idx < 0 ? 0 : (idx + 1) % items.length;
        else if (e.key === "ArrowUp") idx = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
        else if (e.key === "Home") idx = 0;
        else if (e.key === "End") idx = items.length - 1;
        e.preventDefault();
        items[idx]?.focus();
        return;
      }
      if (e.key === "Tab") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => {
      itemRefs.current.filter(Boolean)[0]?.focus();
    });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  const reg = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      itemRefs.current[i] = el;
    },
    []
  );

  // Portal: paid + stripeCustomerId → real billing portal. Never a 404 dead
  // end — anything else routes to /pricing in the plan row below.
  const openPortal = async () => {
    track("user_menu_nav", { item: "plan" });
    setMenuNotice("");
    try {
      const r = await fetch("/api/portal", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) {
        window.location.href = j.url;
        return;
      }
      setMenuNotice(j.error || "We couldn't open subscription management right now.");
    } catch {
      setMenuNotice("We couldn't open subscription management right now.");
    }
  };

  const handleExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    const err = await downloadRecord(tier);
    setExportBusy(false);
    if (err) {
      setMenuNotice(err);
    } else {
      track("user_menu_nav", { item: "export" });
      close();
    }
  };

  const handleLogout = async () => {
    track("user_menu_nav", { item: "logout" });
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* full reload below still lands on a logged-out landing */
    }
    window.location.assign("/");
  };

  const itemBase =
    "flex min-h-11 w-full items-center gap-2 rounded-2xl px-4 text-base font-semibold text-forest transition-colors duration-150 hover:bg-cream-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bys-accent-soft)]";

  const planLabel = paidTier
    ? `Your plan: ${PLAN_PRICES[profile.tier] || "Steady"}`
    : gifted
      ? `Gifted Steady through ${new Date(profile.giftUntil).toLocaleDateString()}`
      : "Free · 5 reviews a month";
  const planHref = paidTier && hasCustomer ? undefined : "/pricing";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Open your menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-forest text-sm font-semibold text-cream transition-colors duration-150 hover:bg-forest-soft"
      >
        {initialsAvatar(name, email)}
      </button>
      {open && (
        <>
          {/* Transparent backdrop click-catcher — closes the menu on any
              outside tap, below the menu itself (z-30 < z-40). */}
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={close} />
          <div
            id="user-menu"
            role="menu"
            aria-label="Your account"
            className="bys-menu-fade absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-3xl border border-line bg-card p-2 shadow-pop max-[480px]:right-3"
          >
            {/* Header row — identity, not an item */}
            <div role="presentation" className="flex items-center gap-3 rounded-2xl px-4 py-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest/10 text-sm font-semibold text-forest"
              >
                {initialsAvatar(name, email)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-ink">{first}</span>
                <span className="block truncate text-sm text-stone">{email}</span>
              </span>
            </div>
            {/* Plan row — portal only when a Stripe customer exists */}
            {planHref ? (
              <a
                ref={reg(0)}
                href={planHref}
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  track("user_menu_nav", { item: "plan" });
                  close();
                }}
                className={itemBase}
              >
                <span className="min-w-0 flex-1 truncate">{planLabel}</span>
                <span aria-hidden="true" className="shrink-0 text-stone">›</span>
              </a>
            ) : (
              <button
                ref={reg(0)}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={openPortal}
                className={itemBase}
              >
                <span className="min-w-0 flex-1 truncate">{planLabel}</span>
                <span aria-hidden="true" className="shrink-0 text-stone">›</span>
              </button>
            )}
            <a
              ref={reg(1)}
              href="/account"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                track("user_menu_nav", { item: "profile_account" });
                close();
              }}
              className={itemBase}
            >
              <span className="min-w-0 flex-1 truncate">Profile &amp; account</span>
              <span aria-hidden="true" className="shrink-0 text-stone">›</span>
            </a>
            {suite ? (
              <button
                ref={reg(2)}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={handleExport}
                disabled={exportBusy}
                className={itemBase}
              >
                <span className="min-w-0 flex-1 truncate">
                  {exportBusy ? "Preparing your record…" : "Export your record"}
                </span>
                <span aria-hidden="true" className="shrink-0 text-stone">›</span>
              </button>
            ) : (
              <a
                ref={reg(2)}
                href="/pricing"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  track("user_menu_nav", { item: "export" });
                  close();
                }}
                className={itemBase}
              >
                <span className="min-w-0 flex-1 truncate">Export — part of Command Center</span>
                <span aria-hidden="true" className="shrink-0 text-stone">›</span>
              </a>
            )}
            <a
              ref={reg(3)}
              href="/consultations"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                track("user_menu_nav", { item: "consultations" });
                close();
              }}
              className={itemBase}
            >
              <span className="min-w-0 flex-1 truncate">Consultations</span>
              <span aria-hidden="true" className="shrink-0 text-stone">›</span>
            </a>
            <a
              ref={reg(4)}
              href="/faq"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                track("user_menu_nav", { item: "help_faq" });
                close();
              }}
              className={itemBase}
            >
              <span className="min-w-0 flex-1 truncate">Help &amp; FAQ</span>
              <span aria-hidden="true" className="shrink-0 text-stone">›</span>
            </a>
            <a
              ref={reg(5)}
              href="/privacy"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                track("user_menu_nav", { item: "privacy" });
                close();
              }}
              className={itemBase}
            >
              <span className="min-w-0 flex-1 truncate">Privacy</span>
              <span aria-hidden="true" className="shrink-0 text-stone">›</span>
            </a>
            {/* Theme row — the existing popover variant renders above the menu */}
            <div className="flex min-h-11 items-center justify-between gap-2 rounded-2xl px-4">
              <span className="text-base font-semibold text-forest">Theme</span>
              <ThemeSwitcher variant="popover" />
            </div>
            {menuNotice && (
              <p role="status" className="px-4 py-2 text-sm leading-relaxed text-stone">
                {menuNotice}
              </p>
            )}
            <div role="presentation" className="mx-2 my-1 h-px bg-line" />
            <button
              ref={reg(6)}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={handleLogout}
              className={itemBase}
            >
              <span className="min-w-0 flex-1 truncate">Log out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
