import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { hasSensitiveQuery, isCleanQueryParam, track, trackFunnelOnce, trackSignupConversion } from "~/lib/analytics";
import { ensureCaptureVariant, type CaptureVariant } from "~/lib/captureVariant";
import { EMAIL_RE } from "~/lib/api";
import { authMeOnce, type AuthState } from "~/lib/checkin";
import { markLoginIntakeActive, maybeStartTrial } from "~/lib/trial";
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute("/login")({
  head: () => ({
    ...seoHead({
      title: "Create your free account — Before You Send",
      description: "Create your free account in seconds — no card needed. Keep your reviews, your log, and your record in one place.",
      path: "/login",
    }),
  }),
  component: Login,
});
// D3 (spec §13 / DECISION.md §13): the 3-question login intake is GONE from
// /login — the questions' job is served by the Co-Parent Check-In elsewhere in
// the funnel, and /login must feel like a continuation (checkout, free-review
// save, or a plain sign-in), never an unrelated questionnaire. The account is
// created INSTANTLY (POST /api/auth/signup — no email-wait, no confirm hop).
// Sensitive return-path security is preserved EXACTLY (§27 gates 4/5): the
// nextRef capture, the URL scrub, the sensitivity-aware hard navigation, and
// the signed-in bounce below are untouched. The trial starts quietly at
// account creation via maybeStartTrial (same as before).
function Login(){
  const nav=useNavigate();
  const router=useRouter();
  // Capture-card A/B: assign/read the 50/50 variant once at render (mirrors
  // ReviewResults) so the email_captured funnel event always carries meta.variant
  // — /login signup-first was firing it with empty meta, polluting the A/B read.
  const [variant]=useState<CaptureVariant>(()=>ensureCaptureVariant());
  const [mode,setMode]=useState<"signup"|"signin">("signup");
  const [email,setEmail]=useState("");
  const [pw,setPw]=useState("");
  const [err,setErr]=useState("");const [forgotOpen,setForgotOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  // Auth-state gate (owner bug report 2026-08-13): the whole card is gated on
  // the /me check; while it resolves, a quiet static shell renders (no
  // "One moment…" loading-only surface — §13). Cached at module scope in
  // checkin.ts (one fetch per page load).
  const [auth,setAuth]=useState<null|AuthState>(null);
  // The card content only renders once the auth state is known AND the visitor
  // is logged out — signed-in users (any tier) bounce to next;/home instead.
  const authReady=auth!==null && !auth.signedIn;
  // TikTok ad clicks land here (/login?ttclid=…) — route them to the paste-box
  // landing so ads hit the same use-first experience, keeping ttclid in the URL
  // for the TikTok pixel on /. Only when there is no ?next= destination.
  useEffect(()=>{
    try {
      const q=new URLSearchParams(window.location.search);
      if(q.has("ttclid")&&!q.has("next")){
        // Conversion-tracking Fix 3 (audit 85fbc48d): mark this load as a ttclid
        // redirect hop BEFORE the replace — initAnalytics (root effect, which
        // runs after this route effect) skips the initial page_view/page_enter,
        // so a TikTok ad click records exactly ONE page_view + ONE page_enter on
        // the final landing page (/?ttclid=X), not two.
        try { sessionStorage.setItem("bys_ttclid_redirect","1"); } catch {}
        const n=new URLSearchParams();
        const v=q.get("ttclid");
        if(v)n.set("ttclid",v);
        const qs=n.toString();
        window.location.replace("/"+(qs?"?"+qs:""));
      }
    } catch {}
  },[]);
  // Preserve an intended destination (?next=/pricing etc. — set from pricing /
  // consultations / checkout-return links, and the landing module tiles as
  // ?next=/home?tab=X) so login returns where the user was heading. Only
  // same-site paths are accepted (no open redirect): must start with "/",
  // never "//" or a scheme, and no backslashes (browsers normalize "/\host"
  // to "//host" — an external hop).
  // P0 hotfix (work order 5300912458): capture the continuation ONCE (lazy ref
  // initializer — first render, before the mount scrub below rewrites the
  // visible URL) and NEVER recompute the destination from the now-clean
  // window.location.search. A raw `next` may carry an encoded Stripe return
  // (?checkout=success&session_id=…) that must survive the scrub; once
  // consumed it is cleared so a later signup/sign-in cannot reuse a stale one.
  const nextRef = useRef<string | null>(null);
  if (nextRef.current === null && typeof window !== "undefined") {
    nextRef.current = (() => {
      try {
        const n = new URLSearchParams(window.location.search).get("next");
        if (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("://") && !n.includes("\\")) return n;
      } catch { /* noop */ }
      return "/home";
    })();
  }
  // P0 hotfix: a saved continuation whose query is sensitive (credential-bearing
  // — e.g. /pricing?checkout=success&session_id=cs_…) MUST use a FULL document
  // navigation (window.location.assign), never router.navigate: the pixels
  // restored on the clean /login must not observe an SPA History API change to
  // a credential-bearing destination. Safe continuations stay SPA navigations.
  function continuationIsSensitive(dest: string): boolean {
    if (!dest || dest === "/home") return false;
    const qi = dest.indexOf("?");
    return hasSensitiveQuery(qi >= 0 ? dest.slice(qi) : "");
  }
  // P0 hotfix: ONE shared continuation helper for the already-signed-in bounce,
  // successful signup, and successful sign-in. Reads the captured ref, clears
  // it (consumed), and picks SPA vs hard navigation by sensitivity.
  const goToNext = useCallback(async (): Promise<void> => {
    const dest = nextRef.current ?? "/home";
    nextRef.current = null; // consumed once
    if (continuationIsSensitive(dest)) {
      window.location.assign(dest);
      return;
    }
    if (dest === "/home") { await nav({ to: "/home" }); }
    else {
      try { await router.navigate({ href: dest }); }
      catch { window.location.assign(dest); }
    }
  }, [nav, router]);
  // P0 hotfix: immediately remove the raw ?next= from the visible URL while
  // preserving only legitimate attribution/UI params (ad params + exact known
  // UI values), so third-party measurement can initialize on the clean URL
  // (initAnalytics runs in the root effect — AFTER this child effect). The
  // captured nextRef is the single source of truth for the destination.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (!q.has("next")) return;
      const clean = new URLSearchParams();
      for (const [k, v] of q) { if (isCleanQueryParam(k, v)) clean.set(k, v); }
      const s = clean.toString();
      window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
    } catch { /* noop */ }
  }, []);
  // Resolve the auth state once (module-cached in checkin.ts — one /me fetch
  // per page load, shared with the Check-In's isPaidUser).
  useEffect(()=>{
    let alive=true;
    authMeOnce().then((a)=>{ if(alive) setAuth(a); });
    return ()=>{ alive=false; };
  },[]);
  // Signed-in visitors don't belong on /login — /login is a no-op for them.
  // Bounce to their destination exactly like a successful submit does (the
  // loading card keeps rendering until navigation lands: no form flash).
  // P0 hotfix: uses the shared goToNext (captured continuation, sensitivity-
  // aware hard navigation).
  useEffect(()=>{
    if(!auth?.signedIn) return;
    void goToNext();
  },[auth,goToNext]);
  // TrialModal suppression (owner 2026-08-13, preserved): the moment the login
  // card renders for a logged-out visitor, mark the session flag trial.ts
  // checks at fire time — /login is a continuation surface, never a second
  // ask (the trial still starts quietly at account creation via
  // maybeStartTrial). The flag lives for the whole tab session.
  useEffect(()=>{
    if(authReady) markLoginIntakeActive();
  },[authReady]);
  // §13 context: the heading + sub explain WHY the account matters based on
  // where the visitor is coming from — continuing checkout, saving a completed
  // free review, or a plain sign-in. The captured nextRef is read once; the
  // destination itself is never altered.
  const dest=nextRef.current;
  const purchaseCtx=!!dest && (dest.startsWith("/pricing")||dest.startsWith("/consultations"));
  const reviewCtx=!!dest && dest.startsWith("/home");
  function switchMode(m:"signup"|"signin"){ setMode(m); setErr(""); }
  async function submitSignup(e:React.FormEvent){
    e.preventDefault();
    const value=email.trim();
    if(!value){ setErr("Enter your email to create your free account."); return; }
    if(!EMAIL_RE.test(value)){ setErr("That email doesn't look right — double-check it."); return; }
    if(pw.length<8){ setErr("Use at least 8 characters."); return; }
    setBusy(true); setErr("");
    trackFunnelOnce("signup_started", { source: "direct" });
    try {
      const r=await fetch("/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email:value,password:pw})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ setErr(j.error||"Could not create your account right now — try again in a minute."); setBusy(false); return; }
      // Funnel (same events as the confirm path, never double-counted):
      // email_submitted persists as email_captured with the A/B variant.
      // account_created (Google conversion tag) is marked with meta.source so
      // /owner can tell the direct signup from the confirm-link path.
      track("email_submitted",{variant,source:"direct"});
      track("account_created",{source:"direct"});
      trackFunnelOnce("signup_completed", { source: "direct" });
      trackSignupConversion({email:j.user?.email||value,transactionId:j.user?.id});
      // Trial auto-start (owner 2026-08-13): the trial-intent marker's grant
      // moves from /confirm to right after the DIRECT signup — the session is
      // live the moment this returns, so the 24h trial starts now and the dad
      // lands in the app with it already active. No marker = instant no-op.
      try { await maybeStartTrial(); } catch { /* never blocks the redirect */ }
      await goToNext();
    } catch {
      setErr("Could not reach the server right now — please try again.");
      setBusy(false);
    }
  }
  async function submitSignin(e:React.FormEvent){
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email,password:pw})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ setErr(j.error||"Email or password is incorrect."); setBusy(false); return; }
      track("login_success",{next:nextRef.current!=="/home"?nextRef.current:undefined});
      await goToNext();
    } catch {
      setErr("Could not reach the server right now — please try again.");
      setBusy(false);
    }
  }
  // Password sign-in is the ONLY sign-in path — email-based magic links are
  // NOT available (email is not integrated; the old "Email me a sign-in link"
  // button hit a dead 503 on the server, per the owner's auto-logout report
  // 75fa1a07). Every account sets a password at signup, so the field below is
  // required. (Passwordless legacy accounts get the "Set a password" card on
  // the dashboard; the forgot-password honesty block below tells the truth.)
  const head = purchaseCtx
    ? { h: "Continue to checkout", s: mode==="signin" ? "Sign in to finish your purchase — we'll bring you right back." : "Create your free account to finish your purchase — we'll bring you right back." }
    : reviewCtx
      ? { h: mode==="signin" ? "Sign in" : "Keep this on your record", s: mode==="signin" ? "Welcome back." : "Your account saves your reviews and builds your record — free." }
      : { h: mode==="signin" ? "Sign in" : "Create your free account", s: mode==="signin" ? "Welcome back." : "Free to start — 5 reviews a month." };
  return <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12"><a href="/" aria-label="Before You Send home" className="-m-1 flex min-h-11 w-fit shrink-0 items-center rounded-lg p-1"><img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7" /></a><div className="card mt-10 p-7">
    {!authReady ? (
      /* Quiet static shell (§13) — no "One moment…" loading-only surface.
         Shapes mirror the form below so the swap to real fields is
         imperceptible; nothing animates. */
      <div aria-busy="true" aria-label="Loading" className="login-shell">
        <div className="h-7 w-2/3 rounded-lg bg-cream-deep" />
        <div className="mt-2 h-4 w-full rounded-lg bg-cream-deep/70" />
        <div className="mt-7 h-12 w-full rounded-[10px] border border-line bg-cream-deep/50" />
        <div className="mt-5 h-12 w-full rounded-[10px] border border-line bg-cream-deep/50" />
        <div className="mt-5 h-12 w-full rounded-[10px] bg-cream-deep/80" />
      </div>
    ) : (
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{head.h}</h1>
        <p className="mt-2 text-base leading-relaxed text-stone">{head.s}</p>
        {mode==="signup" ? <div><form onSubmit={submitSignup} className="mt-6"><label className="field-label" htmlFor="signup-email">Email</label><input id="signup-email" type="email" inputMode="email" autoComplete="email" autoFocus required value={email} onChange={e=>{setEmail(e.target.value);setErr("")}} className="input" placeholder="you@example.com"/><label className="field-label mt-5" htmlFor="signup-password">Password</label><input id="signup-password" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={e=>{setPw(e.target.value);setErr("")}} className="input" placeholder="At least 8 characters"/><button disabled={busy} className="btn-primary mt-5 w-full">{busy?"Creating your account…":purchaseCtx?"Continue to checkout":"Get my free account"}</button>{err&&<p role="alert" className="mt-3 text-base text-red-800">{err}</p>}</form><p className="mt-4 text-center text-base text-stone">Your account, ready in 10 seconds.</p></div>
        : <div><form onSubmit={submitSignin} className="mt-7"><label className="field-label" htmlFor="login-email">Email</label><input id="login-email" type="email" autoComplete="email" required value={email} onChange={e=>{setEmail(e.target.value);setErr("")}} className="input" placeholder="you@example.com"/><label className="field-label mt-5" htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={pw} onChange={e=>{setPw(e.target.value);setErr("")}} className="input" placeholder="Your password"/><button disabled={busy} className="btn-primary mt-6 w-full">{busy?"Signing in…":"Sign in"}</button><button type="button" onClick={()=>setForgotOpen(!forgotOpen)} className="mt-2 flex min-h-11 w-full items-center justify-center text-center text-sm font-semibold text-forest underline">Forgot password?</button>{forgotOpen&&<p className="mt-2 rounded-xl bg-cream-deep px-4 py-3 text-center text-sm leading-relaxed text-stone">Email-based reset isn't set up yet. If you're still signed in on a phone or browser, open <span className="font-semibold">Account → Change password</span> — you can set a new one there. <a href="mailto:Co-Parenting@BeforeYouSend.com?subject=Password%20reset" className="underline underline-offset-2">Or email support</a>.</p>}{err&&<p role="alert" className="mt-3 text-base text-red-800">{err}</p>}</form></div>}
        <div className="mt-6 border-t border-line pt-5 text-center text-base text-stone">{mode==="signup"?<>Already have an account? <button type="button" onClick={()=>switchMode("signin")} className="inline-block py-[10px] font-semibold text-forest underline">Sign in</button></>:<>New here? <button type="button" onClick={()=>switchMode("signup")} className="inline-block py-[10px] font-semibold text-forest underline">Create your free account</button></>}</div>
      </div>
    )}
  </div><p className="mt-8 text-center text-sm leading-relaxed text-taupe">Your drafts stay private. Not legal advice.</p></main>;
}
