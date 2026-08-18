import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { track, trackFunnelOnce, trackSignupConversion } from "~/lib/analytics";
import { EMAIL_RE } from "~/lib/api";
import { maybeStartTrial } from "~/lib/trial";
import { loadLoginIntake, clearLoginIntake } from "~/lib/checkin";
export const Route = createFileRoute("/confirm")({
  head: () => ({
    meta: [
      { title: "Confirm your email — Before You Send" },
      { name: "description", content: "Confirm your email to finish creating your Before You Send account." },
    ],
  }),
  component: Confirm,
});
// Email-only happy path (owner 2026-08-10): a valid confirm token creates the
// account and signs the visitor in WITHOUT a password — Chris's measured 61s
// password wall is gone. "You're in." holds for a beat, then Continue →
// onboarding (or straight to the Command Center for returning users).
// Optional password (returning-user path, tiny ask NOT a wall): a small
// dismissible card offers "Set a password so you can sign back in anytime —
// optional, 10 seconds." Posts to /api/auth/password WITHOUT a token — the
// server's session-authenticated branch (the session already IS the account).
function Confirm(){
  const nav=useNavigate();
  const [state,setState]=useState<"working"|"done"|"error">("working");
  const [err,setErr]=useState("");
  const [user,setUser]=useState<any>(null);
  // Resend path — the 30-minute confirm token can expire before a dad comes
  // back; /api/auth/confirm-link re-issues one for the same email.
  const [showResend,setShowResend]=useState(false);
  const [email,setEmail]=useState("");
  const [resendBusy,setResendBusy]=useState(false);
  const [resendMsg,setResendMsg]=useState("");
  const [resendOk,setResendOk]=useState(false);
  // Batch 1 item 5 (client): a dad who changed his mind can quietly remove the
  // details he typed on the landing page — the failed confirm token is the key
  // (vid-guarded server-side, so only this browser's capture can be removed).
  const [remBusy,setRemBusy]=useState(false);
  const [remMsg,setRemMsg]=useState("");
  const [remOk,setRemOk]=useState(false);
  const [remDone,setRemDone]=useState(false);
  // Optional password card.
  const [pw,setPw]=useState("");
  const [pwBusy,setPwBusy]=useState(false);
  const [pwMsg,setPwMsg]=useState("");
  const [pwOk,setPwOk]=useState(false);
  const [pwDone,setPwDone]=useState(false);
  const [pwSkipped,setPwSkipped]=useState(false);
  // L2: an intended destination (?next=/redeem?code=… etc.) threaded from login
  // survives the confirm hop — a new dad redeeming a gift lands back on the
  // redeem page after signup instead of onboarding. Same-site only (no open
  // redirect), same guard as login.tsx.
  // SSR-safe search parse (Codex b2184c1): window does not exist during the
  // server render — reading window.location.search here crashed the SSR stream
  // (React #419, error boundary, zero "Confirming your account" markup). Parse
  // a render-time-safe value ONCE and derive next/urlToken from it; the mount
  // effect below still reads the real URL as before.
  const renderSearch=typeof window==="undefined"?"":window.location.search;
  const next=(()=>{try{const n=new URLSearchParams(renderSearch).get("next");if(n&&n.startsWith("/")&&!n.startsWith("//"))return n}catch{}return null})();
  const urlToken=new URLSearchParams(renderSearch).get("token")||"";
  useEffect(()=>{
    const token=new URLSearchParams(window.location.search).get("token")||"";
    if(!token){ setState("error"); setErr("This confirmation link is missing its token — request a new one below."); setShowResend(true); return; }
    // Track A (Codex consolidated order §3): scrub the bearer token from the
    // URL immediately — BEFORE any analytics capture (this route effect runs
    // before the root analytics effect, and `next`/`urlToken` were already
    // captured at render, so the Continue button and the remove-details flow
    // keep working). Never persist/send the token.
    try { window.history.replaceState(null, "", "/confirm"); } catch { /* noop */ }
    let alive=true;
    (async()=>{
      try {
        // Login intake (owner 2026-08-13): the answers from the /login questions
        // ride into the account here — stashed in sessionStorage by login.tsx and
        // posted in the confirm body so the server can whitelist them into
        // profile.intake at account creation. Absent = plain signup, unchanged.
        const intake=loadLoginIntake();
        const r=await fetch("/api/auth/confirm",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({token,intake:intake||undefined})});
        const j=await r.json().catch(()=>({}));
        if(!alive)return;
        if(!r.ok){
          setState("error");
          setErr(j.error||"Could not confirm your account right now.");
          if(/invalid or expired/i.test(j.error||"")) setShowResend(true);
          return;
        }
        track("account_created",{source:"confirm-link"});
        trackFunnelOnce("signup_completed", { source: "confirm" });
        trackSignupConversion({email:j.user?.email,transactionId:j.user?.id});
        clearLoginIntake();
        setUser(j.user||null);
        setState("done");
      } catch {
        if(!alive)return;
        setState("error");
        setErr("Could not reach the server right now — try again.");
      }
    })();
    return ()=>{ alive=false; };
  },[]);
  // 24-hour free trial (owner 2026-08-13): a visitor who tapped "Yes, try it
  // free" while anonymous carries a trial-intent marker through the email
  // capture. The moment the account is confirmed the session is live, so this
  // auto-starts the trial — the dad lands in the app with it already active.
  // Idempotent + quiet: no marker = no-op; 409 (already used/active) clears it.
  useEffect(()=>{
    if(state==="done"){ void maybeStartTrial(); }
  },[state]);
  async function resend(e:React.FormEvent){
    e.preventDefault();
    const value=email.trim();
    if(!EMAIL_RE.test(value)){ setResendOk(false); setResendMsg("Enter a valid email address."); return; }
    setResendBusy(true); setResendMsg("");
    try {
      const r=await fetch("/api/auth/confirm-link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:value})});
      const j=await r.json();
      if(!r.ok){ setResendOk(false); setResendMsg(j.error||"Could not resend right now — try again in a minute."); setResendBusy(false); return; }
      // Conversion-tracking Fix 6 (audit 85fbc48d): a resend is NOT a first
      // capture — it fires email_resend so email_captured counts genuine first
      // captures only (the resend never inflates the funnel).
      track("email_resend",{});
      // In-app resend (email unconfigured): the server hands back a fresh token
      // bound to THIS browser — jump straight to it so the confirm effect above
      // re-runs with the new token. (When email IS configured there is no token
      // in the response and the honest "check your inbox" copy shows instead.)
      if(typeof j.token==="string"&&j.token){ window.location.href="/confirm?token="+encodeURIComponent(j.token); return; }
      setResendOk(true);
      setResendMsg("A fresh confirmation link is on its way to that email — it works for 30 minutes.");
      setResendBusy(false);
    } catch {
      setResendOk(false);
      setResendMsg("Could not reach the server right now — please try again.");
      setResendBusy(false);
    }
  }
  async function setPassword(){
    if(pw.length<8){ setPwMsg("Use at least 8 characters."); return; }
    setPwBusy(true); setPwMsg("");
    try {
      const r=await fetch("/api/auth/password",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({password:pw})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ setPwMsg(j.error||"Could not set the password right now."); setPwBusy(false); return; }
      track("password_set",{});
      setPwOk(true); setPwDone(true); setPwMsg("Password set — you can sign back in anytime.");
      setPwBusy(false);
    } catch {
      setPwMsg("Could not reach the server right now — try again.");
      setPwBusy(false);
    }
  }
  async function removeDetails(){
    // Track A: the token was scrubbed from the URL on mount — use the
    // render-time capture instead.
    const t=urlToken||new URLSearchParams(window.location.search).get("token")||"";
    if(!t)return;
    setRemBusy(true); setRemMsg("");
    try {
      const r=await fetch("/api/signup-remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t})});
      const j=await r.json().catch(()=>({}));
      setRemBusy(false);
      if(r.ok){ track("signup_details_removed",{}); setRemOk(true); setRemDone(true); setRemMsg("Your details have been removed."); return; }
      // 404 is the server's honest already-removed line — calm, not an error.
      setRemMsg(j.error||"Couldn't remove your details right now — try again in a minute.");
    } catch {
      setRemBusy(false);
      setRemMsg("Couldn't reach the server right now — try again.");
    }
  }
  return <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12"><a href="/" aria-label="Before You Send home" className="-m-1 flex min-h-11 w-fit shrink-0 items-center rounded-lg p-1"><img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7" /></a><div className="card mt-12 p-7">
    {state==="working"&&<div className="py-6 text-center"><p className="font-display text-2xl font-semibold text-forest">Confirming your account…</p><p className="mt-2 text-base text-stone">One moment — you're almost in.</p></div>}
    {state==="done"&&<><div className="rounded-xl border border-forest/25 bg-forest p-6 text-cream"><p className="text-lg font-semibold">You're in.</p><p className="mt-2 text-base text-cream/85">{user?.profile?.completed?"You're signed in — your record is waiting.":(user?.hadReview?"This review is saved to your record — it's yours.":"You're all set — your free account is ready.")}</p><button onClick={()=>{if(next)window.location.assign(next);else nav({to:user?.profile?.completed?"/home":"/onboarding"})}} className="btn-primary mt-5 w-full bg-cream text-forest hover:bg-cream-deep">Continue →</button></div>{pwDone?<div className="mt-5 rounded-xl border border-forest/25 bg-forest p-5 text-cream"><p className="text-lg font-semibold">Password set.</p><p className="mt-1 text-base text-cream/85">You can sign back in anytime with it.</p></div>:!pwSkipped&&<div className="card mt-5 p-6"><p className="text-lg font-semibold text-forest">Set a password so you can sign back in anytime.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><label htmlFor="confirm-password" className="sr-only">Password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={pw} onChange={e=>{setPw(e.target.value);setPwMsg("")}} placeholder="At least 8 characters" className="input"/><button disabled={pwBusy} onClick={setPassword} className="btn-primary shrink-0">{pwBusy?"Saving…":"Set password"}</button></div>{pwMsg&&<p role={pwOk?"status":"alert"} className={`mt-2 text-base ${pwOk?"text-forest":"text-red-800"}`}>{pwMsg}</p>}<button onClick={()=>setPwSkipped(true)} className="mt-3 min-h-11 text-base text-stone underline">Skip for now</button></div>}</>}
    {state==="error"&&<div><h1 className="font-display text-[1.7rem] font-semibold leading-[1.2] tracking-tight text-forest sm:text-3xl">This confirmation link isn't valid anymore.</h1><p className="mt-3 text-base text-stone">No problem — it happens. {err&&<span className="text-red-800">{err}</span>}</p>{showResend&&<div className="mt-6 border-t border-line pt-6"><p className="text-base font-semibold text-forest">Get a fresh link</p><p className="mt-1 text-base text-stone">Enter the email you used and we'll issue a new one.</p>{resendOk?<p className="mt-4 rounded-xl border border-forest/25 bg-forest p-5 text-cream"><span className="block text-lg font-semibold">Fresh link on its way.</span><span className="mt-1 block text-base text-cream/85">It works for 30 minutes — check your inbox.</span></p>:<form onSubmit={resend} className="mt-4"><label className="field-label" htmlFor="resend-email">Email</label><input id="resend-email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={e=>{setEmail(e.target.value);setResendMsg("")}} className="input" placeholder="you@example.com"/><button disabled={resendBusy} className="btn-ghost mt-4 w-full">{resendBusy?"Sending…":"Resend confirmation link"}</button>{resendMsg&&<p role={resendOk?"status":"alert"} className={`mt-3 text-base ${resendOk?"text-forest":"text-red-800"}`}>{resendMsg}</p>}</form>}</div>}{urlToken&&!remDone&&<div className="mt-6 border-t border-line pt-6"><button type="button" onClick={removeDetails} disabled={remBusy} className="min-h-11 text-base text-stone underline">{remBusy?"Removing…":"Changed your mind? Remove my details"}</button>{remMsg&&<p role={remOk?"status":"alert"} className={`mt-2 text-base ${remOk?"text-forest":"text-stone"}`}>{remMsg}</p>}</div>}</div>}
  </div></main>;
}
