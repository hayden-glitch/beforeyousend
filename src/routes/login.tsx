import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { hasSensitiveQuery, isCleanQueryParam, track, trackFunnelOnce, trackSignupConversion } from "~/lib/analytics";
import { ensureCaptureVariant, type CaptureVariant } from "~/lib/captureVariant";
import { EMAIL_RE } from "~/lib/api";
import { authMeOnce, invalidateAuthCache, type AuthState } from "~/lib/checkin";
import { markLoginIntakeActive } from "~/lib/trial";
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute("/login")({
  head: () => ({
    ...seoHead({
      title: "Create your free account — Before You Send",
      description: "Create your free account in seconds. Keep your reviews, your log, and your record in one place.",
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
// the signed-in bounce below are untouched. New accounts enter the FREE tier
// (no auto trial since 2026-08-17); the 7-day card trial is on /pricing.
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
  const busyRef=useRef(false); // same-tick re-entrancy guard (double-tap before re-render)
  // P0 (login dead-gate fix 2026-08-17): the form renders UNCONDITIONALLY —
  // real inputs are in the SSR HTML from first paint, so there is no
  // auth-gated skeleton window where taps are dead. The /me check below only
  // drives the signed-in BOUNCE (a post-/me effect, decoupled from render).
  const [auth,setAuth]=useState<null|AuthState>(null);
  // Hydration latch: the submit button stays disabled with its visible label
  // until React hydrates, so a pre-hydration tap can't fire a native form
  // GET. Typing IS safe pre-hydration: the inputs are uncontrolled
  // (defaultValue) and the submit handlers read the DOM refs.
  const [hydrated,setHydrated]=useState(false);
  // Uncontrolled input refs — the DOM truth for what the user typed (survives
  // hydration). The state mirrors below exist only for the 409→sign-in
  // prefill, validation copy, and the submit body.
  const emailRef=useRef<HTMLInputElement>(null);
  const pwRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{ setHydrated(true); },[]);
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
    if (dest === "/home") {
      // P1 (login dead-gate fix 2026-08-17): the /home lazy chunk (~88KB) can
      // fail to import on a flaky connection — that rejection must NOT surface
      // as a server error after the account + session ALREADY exist. Hard-
      // navigate to /home instead (same fallback as the else-branch below).
      try { await nav({ to: "/home" }); }
      catch { window.location.assign("/home"); }
    }
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
  // TrialModal suppression (owner 2026-08-13, preserved): /login is a
  // continuation surface, never a second ask — new-signup auto trials were
  // removed 2026-08-17 (free tier on signup), so nothing starts quietly here.
  // P0 fix 2026-08-17: the form now
  // renders for EVERY visitor immediately (no auth gate), so mark the flag at
  // mount unconditionally — a signed-in visitor bounces moments later anyway
  // and never needs the trial modal here. The flag lives for the whole tab.
  useEffect(()=>{
    markLoginIntakeActive();
  },[]);
  // §13 context: the heading + sub explain WHY the account matters based on
  // where the visitor is coming from — continuing checkout, saving a completed
  // free review, or a plain sign-in. P0 fix 2026-08-17: computed once in a
  // post-mount effect into `ctx` (NOT read from nextRef during render) so the
  // SSR HTML and the first hydration render match — no hydration mismatch, and
  // the form is real on first paint with a generic heading that upgrades to
  // the contextual one right after mount.
  const [ctx,setCtx]=useState<"purchase"|"review"|"plain">("plain");
  useEffect(()=>{
    const d=nextRef.current;
    setCtx(!!d && (d.startsWith("/pricing")||d.startsWith("/consultations")) ? "purchase" : !!d && d.startsWith("/home") ? "review" : "plain");
  },[]);
  const purchaseCtx=ctx==="purchase";
  const reviewCtx=ctx==="review";
  function switchMode(m:"signup"|"signin"){ setMode(m); setErr(""); }
  async function submitSignup(e:React.FormEvent){
    e.preventDefault();
    if(busyRef.current) return; // P1: re-entrancy guard (same-tick double-fire)
    busyRef.current=true;
    // Read the DOM truth (refs) — the state mirrors can lag pre-hydration.
    const value=(emailRef.current?.value ?? email).trim();
    if(!value){ setErr("Enter your email to create your free account."); busyRef.current=false; return; }
    if(!EMAIL_RE.test(value)){ setErr("That email doesn't look right — double-check it."); busyRef.current=false; return; }
    const pwValue=pwRef.current?.value ?? pw;
    if(pwValue.length<8){ setErr("Use at least 8 characters."); busyRef.current=false; return; }
    setBusy(true); setErr("");
    trackFunnelOnce("signup_started", { source: "direct" });
    try {
      const r=await fetch("/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email:value,password:pwValue})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){
        if(r.status===409){
          // Returning-dad fix (P0 batch 2026-08-17): the server behavior is
          // UNCHANGED (never adopts an existing confirmed account) — but the
          // client now meets the dad where he is: auto-switch to sign-in with
          // his email pre-filled and a calm note, instead of a wall.
          setEmail(value);
          setMode("signin");
          setErr("Good news — you already have an account. Sign in below.");
          setBusy(false); busyRef.current=false;
          return;
        }
        setErr(j.error||"Could not create your account right now — try again in a minute."); setBusy(false); busyRef.current=false; return;
      }
      // Funnel (same events as the confirm path, never double-counted):
      // email_submitted persists as email_captured with the A/B variant.
      // account_created (Google conversion tag) is marked with meta.source so
      // /owner can tell the direct signup from the confirm-link path.
      track("email_submitted",{variant,source:"direct"});
      track("account_created",{source:"direct"});
      trackFunnelOnce("signup_completed", { source: "direct" });
      trackSignupConversion({email:j.user?.email||value,transactionId:j.user?.id});
      // 24h cardless trial auto-start REMOVED (owner 2026-08-17): new signups
      // land in the free tier — no card, no auto trial. The 7-day card-up-front
      // trial is offered on the pricing plan cards; the legacy TrialModal stays
      // as the explicit signed-in cardless fallback.
      invalidateAuthCache(); // P2: the SPA session's cached /me must see the new session
      busyRef.current=false;
      await goToNext();
    } catch {
      setErr("Could not reach the server right now — please try again.");
      setBusy(false); busyRef.current=false;
    }
  }
  async function submitSignin(e:React.FormEvent){
    e.preventDefault();
    if(busyRef.current) return; // P1: re-entrancy guard (same-tick double-fire)
    busyRef.current=true;
    setBusy(true); setErr("");
    track("login_attempted"); // funnel visibility — status only, never credentials
    try {
      const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email:emailRef.current?.value ?? email,password:pwRef.current?.value ?? pw})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){
        track("login_error",{status:r.status}); // HTTP status only — no PII
        setErr(j.error||"Email or password is incorrect."); setBusy(false); busyRef.current=false; return;
      }
      track("login_success",{next:nextRef.current!=="/home"?nextRef.current:undefined});
      invalidateAuthCache(); // P2: the SPA session's cached /me must see the new session
      busyRef.current=false;
      await goToNext();
    } catch {
      setErr("Could not reach the server right now — please try again.");
      setBusy(false); busyRef.current=false;
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
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-ink">{head.h}</h1>
      <p className="mt-2 text-base leading-relaxed text-stone">{head.s}</p>
      {mode==="signup" ? <div><form onSubmit={submitSignup} className="mt-6"><label className="field-label" htmlFor="signup-email">Email</label><input id="signup-email" ref={emailRef} type="email" inputMode="email" autoComplete="email" autoFocus required defaultValue={email} onChange={e=>{setEmail(e.target.value);setErr("")}} className="input" placeholder="you@example.com"/><label className="field-label mt-5" htmlFor="signup-password">Password</label><input id="signup-password" ref={pwRef} type="password" autoComplete="new-password" minLength={8} required defaultValue={pw} onChange={e=>{setPw(e.target.value);setErr("")}} className="input" placeholder="At least 8 characters"/><button disabled={!hydrated||busy} className="btn-primary mt-5 w-full">{busy?"Creating your account…":purchaseCtx?"Continue to checkout":"Get my free account"}</button>{err&&<p role="alert" className="mt-3 text-base text-red-800">{err}</p>}</form><p className="mt-4 text-center text-base text-stone">Your account, ready in 10 seconds.</p></div>
        : <div><form onSubmit={submitSignin} className="mt-7"><label className="field-label" htmlFor="login-email">Email</label><input id="login-email" ref={emailRef} type="email" autoComplete="email" required defaultValue={email} onChange={e=>{setEmail(e.target.value);setErr("")}} className="input" placeholder="you@example.com"/><label className="field-label mt-5" htmlFor="login-password">Password</label><input id="login-password" ref={pwRef} type="password" autoComplete="current-password" required defaultValue={pw} onChange={e=>{setPw(e.target.value);setErr("")}} className="input" placeholder="Your password"/><button disabled={!hydrated||busy} className="btn-primary mt-6 w-full">{busy?"Signing in…":"Sign in"}</button><button type="button" onClick={()=>setForgotOpen(!forgotOpen)} className="mt-2 flex min-h-11 w-full items-center justify-center text-center text-sm font-semibold text-forest underline">Forgot password?</button>{forgotOpen&&<p className="mt-2 rounded-xl bg-cream-deep px-4 py-3 text-center text-sm leading-relaxed text-stone">Email-based reset isn't set up yet. If you're still signed in on a phone or browser, open <span className="font-semibold">Account → Change password</span> — you can set a new one there. <a href="mailto:Co-Parenting@BeforeYouSend.com?subject=Password%20reset" className="underline underline-offset-2">Or email support</a>.</p>}{err&&<p role="alert" className="mt-3 text-base text-red-800">{err}</p>}</form></div>}
      <div className="mt-6 border-t border-line pt-5 text-center text-base text-stone">{mode==="signup"?<>Already have an account? <button type="button" onClick={()=>switchMode("signin")} className="inline-block py-[10px] font-semibold text-forest underline">Sign in</button></>:<>New here? <button type="button" onClick={()=>switchMode("signup")} className="inline-block py-[10px] font-semibold text-forest underline">Create your free account</button></>}</div>
    </div>
  </div><p className="mt-8 text-center text-sm leading-relaxed text-taupe">Your drafts stay private. Not legal advice.</p></main>;
}
