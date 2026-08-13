import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { track, type AnalyticsEvent } from "~/lib/analytics";
import { ensureCaptureVariant, type CaptureVariant } from "~/lib/captureVariant";
import { EMAIL_RE } from "~/lib/api";
import {
  Q1_CHIPS,
  Q2_CHIPS,
  Q3_CHIPS,
  Q_LABELS,
  loginIntakeDone,
  markLoginIntakeDone,
  saveLoginIntake,
  clearLoginIntake,
  authMeOnce,
  recommend,
  type AuthState,
} from "~/lib/checkin";
import { markLoginIntakeActive, maybeStartTrial } from "~/lib/trial";
import { seoHead } from "~/lib/seo";
import { IconArrowLeft } from "~/components/icons";
export const Route = createFileRoute("/login")({
  head: () => ({
    ...seoHead({
      title: "Create your free account — Before You Send",
      description: "Three quick questions about your situation — then your free account, one step at a time. See how your messages land, and get calm replies.",
      path: "/login",
    }),
  }),
  component: Login,
});
// DIRECT email+password signup (owner 2026-08-13, intake step 4): the very
// first thing on /login — the ad landing — is the 3 Co-Parent Check-In
// questions ("how can we help them"), ONE at a time, big calm chips, progress
// dots. After Q3: one honest personalized line (For: [Q1] · [Q2] · [Q3]) + one
// calm fit line, then the final step is email + password -> the free account
// is created INSTANTLY (POST /api/auth/signup) — no email-wait, no confirm
// hop. The answers ride into the account (profile.intake) via the signup body
// (server-whitelisted). Returning visitors (bys_intake_done flag) and sign-in
// mode skip the intake and see the direct signup form (email + password)
// without the questions. Signed-in users never see any of it — the auth gate
// below bounces them to next;/home (bug fix 2026-08-13).
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
  // ---- Login intake state (owner 2026-08-13) ----
  const [step,setStep]=useState(0); // 0=Q1 1=Q2 2=Q3 3=email+password form
  const [q1,setQ1]=useState<string>();
  const [q2,setQ2]=useState<string>();
  const [q3,setQ3]=useState<string>();
  // Auth-state gate (owner bug report 2026-08-13): the whole card is gated on
  // the /me check — while it resolves, NOTHING of the intake or forms renders.
  // Before this fix a signed-in paid user saw the 3-question intake for the
  // /me round-trip (~1.5s), then it vanished into the signup form (mode stays
  // "signup"): "I saw the how can we help you tab and then it sent me to sign
  // up." Cached at module scope in checkin.ts (one fetch per page load).
  const [auth,setAuth]=useState<null|AuthState>(null);
  const intakeDone=loginIntakeDone();
  // The card content only renders once the auth state is known AND the visitor
  // is logged out — signed-in users (any tier) bounce to next;/home instead.
  const authReady=auth!==null && !auth.signedIn;
  // The intake shows only for a fresh signup-mode visitor who hasn't completed
  // it and isn't paid. step<3 keeps it on the questions; after Q3 the email
  // form replaces it (and bys_intake_done makes the skip permanent).
  const showIntake=authReady && mode==="signup" && !intakeDone && !auth?.paid && step<3;
  const intakeStarted=useRef(false);
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
  const next=(()=>{try{const n=new URLSearchParams(window.location.search).get("next");if(n&&n.startsWith("/")&&!n.startsWith("//")&&!n.includes("://")&&!n.includes("\\"))return n}catch{}return "/home"})();
  // Resolve the auth state once (module-cached in checkin.ts — one /me fetch
  // per page load, shared with the Check-In's isPaidUser).
  useEffect(()=>{
    let alive=true;
    authMeOnce().then((a)=>{ if(alive) setAuth(a); });
    return ()=>{ alive=false; };
  },[]);
  // Signed-in visitors don't belong on /login — /login is a no-op for them.
  // Bounce to their destination exactly like a successful submit does (the
  // loading card keeps rendering until navigation lands: no form flash). A
  // failed nav falls back to a hard assign (same fallback as the submits).
  useEffect(()=>{
    if(!auth?.signedIn) return;
    const go=async()=>{
      try {
        if(next==="/home"){ await nav({to:"/home"}); }
        else {
          try { await router.navigate({ href: next }); }
          catch { window.location.assign(next); }
        }
      } catch { /* navigation already in flight — nothing to do */ }
    };
    go();
  },[auth,next,nav,router]);
  // TrialModal suppression: the moment the intake appears, mark the session
  // flag trial.ts checks at fire time — the intake IS the engagement and the
  // trial starts quietly at account confirm (never two asks on /login). The
  // flag lives for the whole tab session; returning visitors (no intake) never
  // set it and keep the old /login behavior.
  useEffect(()=>{
    if(showIntake) markLoginIntakeActive();
  },[showIntake]);
  // Analytics: fired once when the questions first show. Ad params (ttclid /
  // gad / gclid) ride the intake events' meta where the URL still carries them
  // (the ttclid→/ redirect only happens when there is no ?next=).
  useEffect(()=>{
    if(showIntake && !intakeStarted.current){
      intakeStarted.current=true;
      track("login_intake_started", adParams());
    }
  },[showIntake]);
  function adParams(): Record<string,string>{
    try {
      const q=new URLSearchParams(window.location.search);
      const out: Record<string,string>={};
      for(const k of ["ttclid","gad","gclid"]){ const v=q.get(k); if(v) out[k]=v; }
      return out;
    } catch { return {}; }
  }
  function switchMode(m:"signup"|"signin"){ setMode(m); setErr(""); }
  function back(){ setStep((s)=>Math.max(0,s-1)); }
  function answer(which:1|2|3, value:string){
    track((`login_intake_q${which}_answered`) as AnalyticsEvent, {...adParams(), answer:value});
    if(which===1){ setQ1(value); setStep(1); return; }
    if(which===2){ setQ2(value); setStep(2); return; }
    // Q3 completes the intake: stash the answers for the signup body, set the
    // returning-visitor flag, fire the completed event, then show the
    // email+password form (the personalized line + fit line render above it).
    const a={q1:q1||"",q2:q2||"",q3:value};
    setQ3(value);
    saveLoginIntake(a);
    markLoginIntakeDone();
    track("login_intake_completed", {...adParams(), q1:a.q1, q2:a.q2, q3:a.q3});
    setStep(3);
  }
  async function submitSignup(e:React.FormEvent){
    e.preventDefault();
    const value=email.trim();
    if(!value){ setErr("Enter your email to create your free account."); return; }
    if(!EMAIL_RE.test(value)){ setErr("That email doesn't look right — double-check it."); return; }
    if(pw.length<8){ setErr("Use at least 8 characters."); return; }
    setBusy(true); setErr("");
    // The intake answers (when answered this session) ride into the account in
    // the signup body — the server whitelists them into profile.intake.
    const intake=(q1&&q2&&q3)?{q1,q2,q3}:undefined;
    const source=intake?"intake-direct":"direct";
    try {
      const r=await fetch("/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email:value,password:pw,intake})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ setErr(j.error||"Could not create your account right now — try again in a minute."); setBusy(false); return; }
      // Funnel (same events as the confirm path, never double-counted):
      // email_submitted persists as email_captured with the A/B variant + the
      // intake answers; account_created (Google conversion tag) is marked with
      // meta.source so /owner can tell the direct signup from the confirm-link
      // path. sendBeacon survives the redirect below.
      track("email_submitted",{variant,source,q1:intake?.q1,q2:intake?.q2,q3:intake?.q3});
      track("account_created",{source,q1:intake?.q1,q2:intake?.q2,q3:intake?.q3});
      // Intake bookkeeping: the questions are answered, the answers are in the
      // account — the local copies are done.
      markLoginIntakeDone();
      clearLoginIntake();
      // Trial auto-start (owner 2026-08-13): the trial-intent marker's grant
      // moves from /confirm to right after the DIRECT signup — the session is
      // live the moment this returns, so the 24h trial starts now and the dad
      // lands in the app with it already active. No marker = instant no-op.
      try { await maybeStartTrial(); } catch { /* never blocks the redirect */ }
      if(next==="/home"){ await nav({to:"/home"}); }
      else {
        try { await router.navigate({ href: next }); }
        catch { window.location.assign(next); }
      }
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
      track("login_success",{next:next!=="/home"?next:undefined});
      if(next==="/home"){ await nav({to:"/home"}); }
      else {
        try { await router.navigate({ href: next }); }
        catch { window.location.assign(next); }
      }
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
  const mirrorLine=q1&&q2&&q3?`For: ${[q1,q2,q3].map((a)=>Q_LABELS[a]||a).join(" · ")}`:null;
  // ONE calm fit line from the deterministic recommendation — no price push,
  // no checkout on this page; the offer lives on /pricing and the trial starts
  // at confirm. (recommend() returns null only with no answers — never here.)
  const FIT_LINES: Record<string,string> = {
    steady: "That's what Steady is built for — calm replies, kept in your record.",
    command: "That's what Command Center is built for — your evidence, organized and ready.",
    ultimate: "That's what Ultimate is built for — your whole system in one calm place.",
    consultation: "That's what a conversation with a dad who's been there is for.",
  };
  const fitLine=(()=>{ const rec=q3?recommend(q1,q2,q3):null; return rec?FIT_LINES[rec.plan]:null; })();
  const dots=step===0?1:step===1?2:step===2?3:3;
  return <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12"><a href="/" className="flex items-center gap-2 font-display text-2xl font-semibold text-forest"><img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7" />Before You Send<span className="text-forest-soft">.</span></a><div className="mt-10 rounded-[2rem] border border-line bg-card p-7">
    {!authReady ? <div className="flex min-h-[16rem] items-center justify-center"><h1 className="font-display text-2xl font-semibold text-forest">One moment…</h1></div>
      : showIntake ? <div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {[0,1,2].map((i)=>(<span key={i} className={`h-1.5 w-1.5 rounded-full ${i<dots?"bg-forest":"bg-line"}`} />))}
          </div>
          {step>0 && <button type="button" onClick={back} className="inline-flex min-h-11 items-center text-base font-semibold text-forest"><IconArrowLeft className="h-5 w-5" /> Back</button>}
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold leading-tight text-forest">How can we help you right now?</h1>
        {step===0 && <><h2 className="mt-1 font-display text-xl font-semibold text-forest">What's your situation?</h2><div className="mt-4 grid grid-cols-2 gap-2.5">{Q1_CHIPS.map(([v,l])=>(<button key={v} type="button" onClick={()=>answer(1,v)} className={`min-h-[3.25rem] w-full rounded-2xl border px-4 text-left text-base font-medium transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${q1===v?"border-forest bg-forest/10 text-forest":"border-line bg-cream text-ink"}`}>{l}</button>))}</div></>}
        {step===1 && <><h2 className="mt-1 font-display text-xl font-semibold text-forest">What's the hardest part right now?</h2><div className="mt-4 flex flex-col gap-2.5">{Q2_CHIPS.map(([v,l])=>(<button key={v} type="button" onClick={()=>answer(2,v)} className={`min-h-[3.25rem] w-full rounded-2xl border px-4 text-left text-base font-medium transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${q2===v?"border-forest bg-forest/10 text-forest":"border-line bg-cream text-ink"}`}>{l}</button>))}</div></>}
        {step===2 && <><h2 className="mt-1 font-display text-xl font-semibold text-forest">What would help most right now?</h2><div className="mt-4 grid grid-cols-2 gap-2.5">{Q3_CHIPS.map(([v,l])=>(<button key={v} type="button" onClick={()=>answer(3,v)} className={`min-h-[3.25rem] w-full rounded-2xl border px-4 text-left text-base font-medium transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${q3===v?"border-forest bg-forest/10 text-forest":"border-line bg-cream text-ink"}`}>{l}</button>))}</div></>}
      </div>
      : mode==="signup" ? <div><h1 className="font-display text-3xl font-semibold tracking-tight text-forest">{q1&&q2&&q3?"Your free account":"Create your free account"}</h1>{mirrorLine&&<p className="mt-3 text-base font-medium text-forest">{mirrorLine}</p>}{fitLine&&<p className="mt-1 text-base leading-relaxed text-stone">{fitLine}</p>}<p className="mt-3 text-base text-stone">Your reviews, saved to your record. No card needed.</p><form onSubmit={submitSignup} className="mt-6"><label className="field-label" htmlFor="signup-email">Email</label><input id="signup-email" type="email" inputMode="email" autoComplete="email" autoFocus required value={email} onChange={e=>{setEmail(e.target.value);setErr("")}} className="input" placeholder="you@example.com"/><label className="field-label mt-5" htmlFor="signup-password">Password</label><input id="signup-password" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={e=>{setPw(e.target.value);setErr("")}} className="input" placeholder="At least 8 characters"/><button disabled={busy} className="btn-primary mt-5 w-full">{busy?"Creating your account…":"Get my free account"}</button>{err&&<p role="alert" className="mt-3 text-base text-red-800">{err}</p>}</form><p className="mt-4 text-center text-base text-stone">Your account, ready in 10 seconds.</p></div>
      : <div><h1 className="font-display text-3xl font-semibold tracking-tight text-forest">Sign in</h1><p className="mt-3 text-base text-stone">Welcome back. Your saved reviews, log, and timeline are waiting.</p><form onSubmit={submitSignin} className="mt-7"><label className="field-label" htmlFor="login-email">Email</label><input id="login-email" type="email" autoComplete="email" required value={email} onChange={e=>{setEmail(e.target.value);setErr("")}} className="input" placeholder="you@example.com"/><label className="field-label mt-5" htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={pw} onChange={e=>{setPw(e.target.value);setErr("")}} className="input" placeholder="Your password"/><button disabled={busy} className="btn-primary mt-6 w-full">{busy?"Signing in…":"Sign in"}</button><button type="button" onClick={()=>setForgotOpen(!forgotOpen)} className="mt-2 block w-full text-center text-sm font-semibold text-forest underline">Forgot password?</button>{forgotOpen&&<p className="mt-2 rounded-2xl bg-cream-deep px-4 py-3 text-center text-sm leading-relaxed text-stone">Email-based reset isn't set up yet. If you're still signed in on a phone or browser, open <span className="font-semibold">Account → Change password</span> — you can set a new one there. <a href="mailto:before-you-send-615d3704@ctomail.io?subject=Password%20reset" className="underline underline-offset-2">Or email support</a>.</p>}{err&&<p role="alert" className="mt-3 text-base text-red-800">{err}</p>}</form></div>}
    {authReady && <div className="mt-6 border-t border-line pt-5 text-center text-base text-stone">{mode==="signup"?<>Already have an account? <button type="button" onClick={()=>switchMode("signin")} className="inline font-semibold text-forest underline">Sign in</button></>:<>New here? <button type="button" onClick={()=>switchMode("signup")} className="inline font-semibold text-forest underline">Create your free account</button></>}</div>}
  </div><p className="mt-8 text-center text-sm leading-relaxed text-taupe">No invented testimonials. No outcome promises. Not legal advice. Cancel anytime.</p></main>;
}
