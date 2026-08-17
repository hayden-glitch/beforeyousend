// /account — "Profile & account" (owner-batch DESIGN 2, §2.7). Authenticated
// route mirroring home.tsx's auth gate (fetch /api/auth/me; 401 → redirect
// "/"; 5xx → retry once → calm error card). One card per section, additive by
// design: future profile fields (separate data-strategy spec, in flight —
// co-parent/child/case fields) slot in as new <CardSection> children below,
// no restructuring.
//
// NO new server endpoints (Design 2 constraint): everything here rides
// existing /api/auth/profile, /api/auth/password, /api/portal, /api/export,
// /api/account. The name save MUST resend situation+help — handleProfile
// (server-api.ts L1810-1811) overwrites all three when name is present, so
// omitting them wipes the dad's onboarding answers.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { seoHead } from "~/lib/seo";
import { track } from "~/lib/analytics";
import { downloadRecord } from "~/lib/exportRecord";
import UserMenu from "~/components/UserMenu";

export const Route = createFileRoute("/account")({
  head: () => ({
    ...seoHead({
      title: "Account — Before You Send",
      description: "Your Before You Send account: profile, email, password, plan and billing, export, and deleting your account.",
      path: "/account",
    }),
  }),
  component: AccountPage,
});

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  steady: "Steady",
  command: "Command Center",
  ultimate: "Ultimate Co-Parent",
};
// Real plan prices (owner 2026-08-11 price cut — matches pricing.tsx).
const PLAN_PRICES: Record<string, string> = {
  steady: "Steady · $4.99/mo",
  command: "Command Center · $12.49/mo",
  ultimate: "Ultimate Co-Parent · $24.99/mo",
};

function SettingsSection({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-6">
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      {sub && <p className="mt-0.5 text-base leading-relaxed text-stone">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AccountPage() {
  const nav = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [authState, setAuthState] = useState<"checking" | "ready" | "error">("checking");
  const [authRetry, setAuthRetry] = useState(0);
  const [notice, setNotice] = useState("");
  const accountViewFired = useRef(false);

  const profile = (user?.profile || {}) as Record<string, any>;
  const tier = user?.quota?.tier || profile.tier || "free";
  const suite = tier === "command" || tier === "ultimate";
  const paidTier = profile.tier === "steady" || profile.tier === "command" || profile.tier === "ultimate";
  const hasCustomer = !!profile.stripeCustomerId;
  const gifted = !!profile.giftUntil && new Date(profile.giftUntil).getTime() > Date.now();
  const childName = typeof profile.children?.[0]?.name === "string" ? profile.children[0].name : "";

  // Auth gate (same pattern as home.tsx A1×B1): the session verdict comes from
  // /api/auth/me; a true no-session 401 ({user:null}) redirects to "/"; 5xx or
  // a network error retries once after ~1.5s, then a calm in-page error.
  useEffect(() => {
    let cancelled = false;
    const apply = async (r: Response): Promise<"ok" | "retry" | "gone"> => {
      if (r.status === 401) {
        const j = await r.json().catch(() => ({ user: null }));
        return j && j.user == null ? "gone" : "retry";
      }
      if (!r.ok) return "retry";
      const j = await r.json().catch(() => null);
      if (!j || !j.user) return "retry";
      setUser({ ...(j.user || {}), quota: j.quota });
      return "ok";
    };
    const settle = (res: "ok" | "retry" | "gone") => {
      if (res === "gone") { nav({ to: "/" }); return; }
      if (res === "retry") { setAuthState("error"); return; }
      setAuthState("ready");
    };
    (async () => {
      try {
        let res = await apply(await fetch("/api/auth/me"));
        if (res === "retry") {
          await new Promise((r2) => setTimeout(r2, 1500));
          if (cancelled) return;
          res = await apply(await fetch("/api/auth/me"));
        }
        if (cancelled) return;
        settle(res);
      } catch {
        try {
          await new Promise((r2) => setTimeout(r2, 1500));
          if (cancelled) return;
          settle(await apply(await fetch("/api/auth/me")));
        } catch {
          if (!cancelled) setAuthState("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authRetry, nav]);

  useEffect(() => {
    if (authState === "ready" && !accountViewFired.current) {
      accountViewFired.current = true;
      track("account_view", {});
    }
  }, [authState]);

  // Section 1 — Profile (name edit; MUST resend situation+help or the server
  // overwrite branch wipes them).
  const [name, setName] = useState("");
  useEffect(() => {
    if (user?.profile?.name !== undefined) setName(user.profile.name);
  }, [user]);
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const saveProfile = async () => {
    setSaving(true);
    setProfileMsg("");
    setProfileSaved(false);
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          situation: Array.isArray(profile.situation) ? profile.situation : [],
          help: Array.isArray(profile.help) ? profile.help : [],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        if (j.user) setUser((u: any) => ({ ...u, profile: j.user.profile }));
        setProfileSaved(true);
        setProfileMsg("Saved.");
        track("account_profile_saved", {});
      } else {
        setProfileMsg(j.error || "Couldn't save that right now.");
      }
    } catch {
      setProfileMsg("Couldn't save that right now — please try again.");
    }
    setSaving(false);
  };

  // Section 3 — Password (set only when none exists; handlePassword rejects
  // existing-password users, so no change UI is ever rendered).
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [curPw, setCurPw] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwDone, setPwDone] = useState(false);
  const setPassword = async (opts?: { reset?: boolean }) => {
    if (pw.length < 8) { setPwMsg("Use at least 8 characters."); return; }
    if (!opts?.reset && user?.hasPassword && !curPw) { setPwMsg("Enter your current password."); return; }
    setPwBusy(true);
    setPwMsg("");
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: pw,
          ...(opts?.reset ? { reset: true } : user?.hasPassword ? { currentPassword: curPw } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setPwMsg(j.error || "Could not set the password right now."); setPwBusy(false); return; }
      track("password_set", {});
      setPwDone(true);
      setPwOpen(false);
      setPwMsg("");
      setUser((u: any) => ({ ...u, hasPassword: true }));
      setPwBusy(false);
    } catch {
      setPwMsg("Could not reach the server right now — try again.");
      setPwBusy(false);
    }
  };

  // Section 4 — Plan & billing (portal only when a Stripe customer exists;
  // paid-without-customer / gifted / free route to /pricing — never a 404).
  const [portalBusy, setPortalBusy] = useState(false);
  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const r = await fetch("/api/portal", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) { window.location.href = j.url; return; }
      setNotice(j.error || "We couldn't open subscription management right now.");
    } catch {
      setNotice("We couldn't open subscription management right now.");
    }
    setPortalBusy(false);
  };

  // Section 5 — Export (Command/Ultimate entitlement, server-gated too).
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const handleExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportMsg("");
    const err = await downloadRecord(tier);
    setExportBusy(false);
    if (err) setExportMsg(err);
    else setExportMsg("Your record is downloaded.");
  };

  // Section 7 — Account (same copy + behavior as home.tsx L291-296).
  const deleteAccount = async () => {
    if (!window.confirm("Delete your account permanently? This removes your saved reviews, communication log, and event timeline, and cancels any paid plan. It can't be undone.")) return;
    const r = await fetch("/api/account", { method: "DELETE" });
    if (r.ok) {
      setNotice("Your account and data have been deleted. Take care, and come back anytime.");
      setTimeout(() => nav({ to: "/" }), 1600);
    } else {
      const j = await r.json().catch(() => ({}));
      setNotice(j.error || "Couldn't delete the account right now — please try again.");
    }
  };

  if (authState === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-forest/20 border-t-forest" aria-hidden="true" />
          <p className="mt-4 text-base text-stone">Loading your account…</p>
        </div>
      </div>
    );
  }
  if (authState === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5">
        <div className="card w-full max-w-md p-7 text-center">
          <h1 className="font-display text-2xl font-semibold leading-snug text-forest">We couldn't reach the server — give it a moment.</h1>
          <button
            type="button"
            onClick={() => { setAuthRetry((n) => n + 1); setAuthState("checking"); }}
            className="btn-primary mt-6 w-full"
          >
            Retry
          </button>
          <a href="/" className="btn-ghost mt-3 w-full">Back to home</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-16">
      <header className="sticky top-0 z-20 min-h-16 border-b border-line/70 bg-cream">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-2">
          <a href="/home" aria-label="Before You Send home" className="-m-1 flex min-h-11 shrink-0 items-center rounded-lg p-1">
            <img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7" />
          </a>
          <UserMenu user={user} tier={tier} context="dashboard" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        <a href="/home" className="inline-flex min-h-11 items-center text-base font-semibold text-forest underline underline-offset-4">
          ← Back to Command Center
        </a>
        <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-forest sm:text-5xl">Account</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-stone">
          Your profile, plan, and privacy.
        </p>

        <div className="mt-4 border-t border-line">
          {/* 1 — Profile. Future profile fields (co-parent/child/case — data
              strategy spec, in flight) slot in as new cards below this one,
              additively; no restructuring needed. */}
          <SettingsSection title="Profile" sub="What we call you — used on your dashboard and in your record.">
            <label htmlFor="account-name" className="field-label">Your name</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="account-name"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setProfileSaved(false); }}
                maxLength={100}
                placeholder="Your name"
                className="input"
              />
              <button onClick={saveProfile} disabled={saving || !name.trim()} className="btn-primary shrink-0">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {profileMsg && (
              <p role="status" className={`mt-2 text-base ${profileSaved ? "text-forest" : "text-red-800"}`}>
                {profileMsg}
              </p>
            )}
            {childName && (
              <p className="mt-3 text-base leading-relaxed text-stone">
                The Organizer folder is set up for{" "}
                <a href="/home?tab=organizer" className="font-semibold text-forest underline underline-offset-4">
                  {childName}
                </a>
                .
              </p>
            )}
          </SettingsSection>

          {/* 2 — Email (read-only; no change endpoint exists). */}
          <SettingsSection title="Email" sub="Your email is your sign-in — it can't be changed yet.">
            <p className="min-h-12 w-full rounded-xl border border-line bg-cream-deep px-4 py-3 text-base text-ink">
              {user?.email || ""}
            </p>
          </SettingsSection>

          {/* 3 — Password (set flow when none exists; honest state otherwise). */}
          <SettingsSection title="Password">
            {user?.hasPassword ? (
              <div>
                <p className="text-base leading-relaxed text-stone">Change it here if you'd like a new one.</p>
                {pwDone ? (
                  <p className="mt-2 text-base text-forest" role="status">Password updated — you can sign in with it.</p>
                ) : pwOpen ? (
                  <div className="mt-3">
                    <label className="field-label" htmlFor="account-curpw">Current password</label>
                    <input id="account-curpw" type="password" autoComplete="current-password" value={curPw} onChange={(e) => { setCurPw(e.target.value); setPwMsg(""); }} className="input" />
                    <label className="field-label mt-4" htmlFor="account-password">New password</label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input id="account-password" type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => { setPw(e.target.value); setPwMsg(""); }} placeholder="At least 8 characters" className="input" />
                      <button onClick={() => setPassword()} disabled={pwBusy} className="btn-primary shrink-0">{pwBusy ? "Saving…" : "Change password"}</button>
                      <button onClick={() => setPwOpen(false)} className="btn-ghost shrink-0 text-stone">Cancel</button>
                    </div>
                    <button type="button" onClick={() => setForgotOpen(!forgotOpen)} className="mt-3 min-h-11 text-base text-stone underline underline-offset-4">Forgot it?</button>
                    {forgotOpen && (
                      <p className="mt-2 rounded-2xl bg-cream-deep/60 p-4 text-sm leading-relaxed text-stone">
                        If you're still signed in, you can set a new one without the old. <button type="button" onClick={() => setPassword({ reset: true })} disabled={pwBusy} className="font-semibold text-forest underline underline-offset-4">{pwBusy ? "Saving…" : "Set a new one now"}</button>
                      </p>
                    )}
                    {pwMsg && !pwDone && <p role="alert" className="mt-2 text-base text-red-800">{pwMsg}</p>}
                  </div>
                ) : (
                  <button onClick={() => { setPwOpen(true); setPwDone(false); setPwMsg(""); }} className="chip mt-3">Change password →</button>
                )}
              </div>
            ) : (
              <>
                <p className="text-base leading-relaxed text-stone">Optional — lets you sign back in anytime from any browser.</p>
                {pwDone ? (
                  <p className="mt-2 text-base text-forest" role="status">Password set — you can sign in anytime.</p>
                ) : pwOpen ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor="account-password" className="sr-only">Password</label>
                    <input
                      id="account-password"
                      type="password"
                      minLength={8}
                      value={pw}
                      onChange={(e) => { setPw(e.target.value); setPwMsg(""); }}
                      placeholder="At least 8 characters"
                      className="input"
                    />
                    <button onClick={() => setPassword()} disabled={pwBusy} className="btn-primary shrink-0">
                      {pwBusy ? "Saving…" : "Set password"}
                    </button>
                    <button onClick={() => setPwOpen(false)} className="btn-ghost shrink-0 text-stone">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setPwOpen(true)} className="chip mt-3">
                    Set a password →
                  </button>
                )}
                {pwMsg && !pwDone && <p role="alert" className="mt-2 text-base text-red-800">{pwMsg}</p>}
              </>
            )}
          </SettingsSection>

          {/* 4 — Plan & billing (portal only with a Stripe customer id). */}
          <SettingsSection title="Plan &amp; billing">
            <p className="text-lg font-semibold text-ink">
              {paidTier ? PLAN_PRICES[profile.tier] || PLAN_LABELS[profile.tier] || "Paid" : PLAN_LABELS[tier] || "Free"}
            </p>
            {gifted && (
              <p className="mt-1 text-base text-stone">
                Gifted month through {new Date(profile.giftUntil).toLocaleDateString()}.
              </p>
            )}
            {paidTier && profile.tierRenewsAt && (
              <p className="mt-1 text-base text-stone">Renews {new Date(profile.tierRenewsAt).toLocaleDateString()}.</p>
            )}
            {paidTier && hasCustomer ? (
              <button onClick={openPortal} disabled={portalBusy} className="btn-primary mt-4">
                {portalBusy ? "Opening…" : "Manage subscription"}
              </button>
            ) : (
              <a href="/pricing" className="btn-primary mt-4 inline-flex items-center text-center">
                See plans →
              </a>
            )}
          </SettingsSection>

          {/* 5 — Export (Command/Ultimate entitlement; honest teaser otherwise). */}
          <SettingsSection
            title="Export your record"
            sub={
              suite
                ? "Everything you've saved — reviews, log, timeline, documents, and case summary — in one file."
                : "Your whole record in one file. Part of Command Center."
            }
          >
            {suite ? (
              <>
                <button onClick={handleExport} disabled={exportBusy} className="btn-primary">
                  {exportBusy ? "Preparing your file…" : "Download your record"}
                </button>
                {exportMsg && (
                  <p role="status" className={`mt-2 text-base ${exportMsg === "Your record is downloaded." ? "text-forest" : "text-red-800"}`}>
                    {exportMsg}
                  </p>
                )}
              </>
            ) : (
              <a href="/pricing" className="btn-primary inline-flex items-center text-center">
                See Command Center →
              </a>
            )}
          </SettingsSection>

          {/* 6 — Privacy. */}
          <SettingsSection title="Privacy" sub="What we collect, how it's handled, and how to delete your data — in plain language.">
            <a href="/privacy" className="inline-flex min-h-11 items-center text-base font-semibold text-forest underline underline-offset-4">
              Read the privacy policy →
            </a>
          </SettingsSection>

          {/* 7 — Account (delete — calm, red, at the bottom). */}
          <SettingsSection title="Account" sub="Delete your account and everything in it — saved reviews, log, and timeline.">
            <button onClick={deleteAccount} className="min-h-11 rounded-[10px] border border-red-900/30 bg-card px-5 text-base font-semibold text-red-900">
              Delete my account
            </button>
          </SettingsSection>
        </div>

        {notice && (
          <p className="mt-5 rounded-xl bg-cream-deep px-4 py-3 text-base text-stone" role="status">
            {notice}
          </p>
        )}
      </main>
    </div>
  );
}
