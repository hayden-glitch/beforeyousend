import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import { seoHead } from "~/lib/seo";

// Calm-loop slice 2 — gift-a-month redemption. One calm one-step page: the dad
// arrives with ?code= (or types the code a friend texted him), signs in if
// needed, taps "Redeem my month", done. Error copy maps exactly to the server's
// 404/409/410/400 responses. No pressure, no [×], no urgency — just the month.

export const Route = createFileRoute("/redeem")({
  head: () => ({
    ...seoHead({
      title: "Redeem a gift month — Before You Send",
      description: "A month of Steady, gifted by another co-parent. Sign in, enter the code, done.",
      path: "/redeem",
    }),
  }),
  component: Redeem,
});

function Redeem() {
  const [user, setUser] = useState<any>(null); // null until /api/auth/me resolves
  const [meLoaded, setMeLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<null | { banked: boolean }>(null);
  // L9 + QA round B #3: recognized-on-load state — the code on the page is
  // already used (by someone else) or expired; calm copy, no urgency.
  const [usedInfo, setUsedInfo] = useState<null | { kind: "used" | "expired" }>(null);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const c = (q.get("code") || "").trim().toUpperCase();
      if (c) setCode(c);
      // Track A (Codex consolidated order §3): the gift code is a redeemable
      // credential — scrub it from the URL immediately after capture (it stays
      // in component state for the flow) so it never reaches analytics, the
      // referrer, or third-party navigation.
      try { if (window.location.search) window.history.replaceState(null, "", window.location.pathname); } catch { /* noop */ }
    } catch {}
    fetch("/api/auth/me")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.user) setUser(j.user);
      })
      .catch(() => {})
      .finally(() => setMeLoaded(true));
  }, []);

  // gift_redeem_view: a valid code is on the page and the dad is signed in.
  useEffect(() => {
    if (meLoaded && user && code && !done) track("gift_redeem_view", {});
  }, [meLoaded, user, code, done]);

  // L9: recognize code states ON LOAD, not only on submit — a code this
  // account already redeemed re-shows the success state; one used by someone
  // else (or expired) shows a calm state instead of the form. GET is read-only
  // (the actual redeem stays exclusively on the submit path).
  useEffect(() => {
    if (!meLoaded || !user || !code || done || usedInfo) return;
    let alive = true;
    fetch("/api/gifts/status?code=" + encodeURIComponent(code))
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!alive || !r.ok || !j || typeof j.status !== "string") return;
        if (j.status === "used") {
          if (j.redeemedByMe) {
            const paid = !!user?.profile?.tier && ["steady", "command", "ultimate"].includes(user.profile.tier);
            setDone({ banked: paid });
          } else {
            setUsedInfo({ kind: "used" });
          }
        } else if (j.status === "expired") {
          setUsedInfo({ kind: "expired" });
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [meLoaded, user, code, done, usedInfo]);

  const activeCode = (input || code).trim().toUpperCase();

  const redeem = async () => {
    const c = activeCode;
    if (!c) {
      setErr("Enter the gift code from the dad who shared it.");
      return;
    }
    setBusy(true);
    setErr("");
    setUsedInfo(null);
    try {
      const r = await fetch("/api/gifts/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const paid = !!user?.profile?.tier && ["steady", "command", "ultimate"].includes(user.profile.tier);
        setDone({ banked: paid });
        track("gift_redeemed", { plan: paid ? user.profile.tier : "steady" });
      } else if (r.status === 409) {
        setUsedInfo({ kind: "used" });
      } else if (r.status === 410) {
        setUsedInfo({ kind: "expired" });
      } else {
        setErr(j.error || "We couldn't redeem that code right now.");
      }
    } catch {
      setErr("Could not reach the server right now — try again.");
    }
    setBusy(false);
  };

  const nextHref = `/login?next=${encodeURIComponent("/redeem" + (activeCode ? `?code=${encodeURIComponent(activeCode)}` : ""))}`;

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <a href="/" aria-label="Before You Send home" className="-m-1 flex min-h-11 w-fit shrink-0 items-center rounded-lg p-1">
        <img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7" />
      </a>

      <div className="card mt-10 p-7">
        {!meLoaded ? (
          <p className="text-base text-stone">One moment…</p>
        ) : done ? (
          <div>
            <p className="text-lg font-semibold text-forest">
              {done.banked ? "Your gift month is banked — it covers you if you ever switch to the free plan." : "A month of Steady is on your account."}
            </p>
            {!done.banked && (
              <p className="mt-2 text-base text-stone">It starts now — 30 reviews a month, unlimited history.</p>
            )}
            <a href="/home" className="btn-primary mt-6 block w-full text-center">Open your Command Center →</a>
          </div>
        ) : usedInfo ? (
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-forest">
              {usedInfo.kind === "used" ? "That code has already been used." : "That code has expired."}
            </h1>
            <p className="mt-3 text-base text-stone">
              {usedInfo.kind === "used"
                ? "Each code works once — the gift month went to the dad who redeemed it first."
                : "Gift codes are good for 90 days, and this one has run its course."}
            </p>
            <button
              onClick={() => { setUsedInfo(null); setInput(""); setCode(""); setErr(""); }}
              className="btn-primary mt-6 min-h-12 w-full"
            >
              Redeem another code
            </button>
          </div>
        ) : user ? (
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-forest">Redeem your gift</h1>
            <p className="mt-3 text-base text-stone">One month of Steady, from a dad who shared it.</p>
            <label className="field-label mt-6" htmlFor="redeem-code">Gift code</label>
            <input
              id="redeem-code"
              value={activeCode}
              onChange={(e) => { setInput(e.target.value.toUpperCase()); if (e.target.value) setCode(""); setErr(""); setUsedInfo(null); }}
              placeholder="BYS-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="input font-mono tracking-wider"
            />
            {err && <p role="alert" className="mt-3 text-base text-red-800">{err}</p>}
            <button onClick={redeem} disabled={busy || !activeCode} className="btn-primary mt-5 min-h-12 w-full">
              {busy ? "Redeeming…" : "Redeem my month"}
            </button>
            {!err && activeCode && (
              <p className="mt-3 text-sm text-stone">Your 5-free-review cap and everything else stay untouched until your month is active.</p>
            )}
          </div>
        ) : (
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-forest">You&apos;ve been gifted a month</h1>
            <p className="mt-3 text-base text-stone">This code gives one month of Steady to a dad.</p>
            {activeCode && (
              <p className="mt-4 rounded-xl border border-line bg-cream-deep px-4 py-3 text-center font-mono text-lg font-semibold tracking-wider text-forest">{activeCode}</p>
            )}
            <a href={nextHref} className="btn-primary mt-6 block min-h-12 w-full text-center">Create a free account</a>
            <a href={nextHref} className="mt-3 block min-h-11 text-center text-base font-semibold text-forest underline underline-offset-4">Sign in</a>
            <p className="mt-4 text-sm leading-relaxed text-stone">Sign in or create a free account — then enter the code and the month is yours. No card.</p>
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-sm leading-relaxed text-taupe">No invented testimonials. No outcome promises. Not legal advice.</p>
    </main>
  );
}
