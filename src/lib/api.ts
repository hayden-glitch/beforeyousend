export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Build the in-app confirm destination from a save/confirm-link response. The
// server returns the raw token when email is unconfigured (in-app confirm flow);
// some responses carry a ready-made link instead. Empty string = no in-app path
// (email was actually sent — "check your inbox").
export function confirmPath(token?: unknown, link?: unknown): string {
  if (typeof token === "string" && token) return "/confirm?token=" + encodeURIComponent(token);
  return typeof link === "string" ? link : "";
}
export async function saveReview(email:string,draft:string,review:string){const r=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,draft,review})});return r.json()}
export type ReviewEvent={type:string;[key:string]:any};
// Attachments (Steady+, owner 2026-08-11): NAME + NOTE ONLY — the client
// reads only file.name (+ a type guard) and NEVER reads file bytes, so the
// pixels never leave the device and the no-OCR/privacy lines are trivially
// true. The server injects these as LLM context and persists nothing.
export type Attachment={name:string;description:string};
// Calm error copy per tool (two-mode AI Co-Parent, 2026-08-11): the review and
// the analyzer share ONE hardened streaming client so the error-path fixes from
// commit 817277f (200-with-error-sized-body, empty stream, EOF-before-terminal,
// 170s deadline, abort-refunds-slot) apply identically to both modes.
type StreamCopy = { couldNotRun: string; noBody: string; timeout: string; eof: string };
const REVIEW_COPY: StreamCopy = {
  couldNotRun: "This review couldn't run right now.",
  noBody: "The review didn't come through. Check your connection and try again.",
  timeout: "This is taking longer than usual. You can retry — nothing's lost.",
  eof: "The review didn't finish. Your message is safe — try again.",
};
const ANALYZE_COPY: StreamCopy = {
  couldNotRun: "This analysis couldn't run right now.",
  noBody: "The analysis didn't come through. Check your connection and try again.",
  timeout: "This is taking longer than usual. You can retry — nothing's lost.",
  eof: "The analysis didn't finish. Your situation is safe — try again.",
};
async function streamNDJSON(path:string,payload:Record<string,unknown>,onEvent:(e:ReviewEvent)=>void,signal?:AbortSignal,copy:StreamCopy = REVIEW_COPY){
  // P0 (2026-08-12): every rejection carries a machine-readable `code`
  // (empty_stream / eof / empty_body / timeout / http_*) so the UI can stamp
  // review_failed meta precisely instead of "unknown". The calm message text is
  // unchanged — same vocabulary, more signal for the owner dashboard.
  const codeError = (msg: string, code: string) => { const e = new Error(msg) as Error & { code?: string }; e.code = code; return e; };
  // H1 fix: an internal AbortController (chained to the caller's signal) lets
  // the deadline abort the fetch itself — the server's cancel path then refunds
  // the quota slot instead of finishing the stream unseen and burning it.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  // Mid-stream stall fix (live QA 2026-08-11, build 7e8592c): the old deadline
  // armed only AFTER fetch() resolved, so a server that accepted the connection
  // but never sent response headers (a stall in quota/DB bookkeeping or any
  // pre-stream await) left the client with NO watchdog at all — the streaming
  // pill showed forever with no error card and no retry. Now the SAME absolute
  // bound runs from REQUEST START and covers every phase: the fetch itself
  // (headers never arriving), each stream read, and EOF. It is an absolute
  // deadline — NOT an idle timer — so a trickling provider still gets cut.
  // 75s (conversion-cycle-1 2026-08-13, down from 90s): the server's own 45s
  // provider deadline + the hosting function's ~60s hard limit fire first in
  // practice; this bound is the backstop for a server that never responds at
  // all, and 75s keeps that worst-case wait reasonable for a mobile dad (the
  // ~12s stalled line in ReviewResults resets the expectation long before).
  // On timeout the fetch is aborted so the server's abort path runs (lazy
  // quota means nothing burns). Calm copy unchanged — no urgency, nothing lost.
  const deadline=Date.now()+75000;
  const TIMEOUT_MSG=copy.timeout;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const raceDeadline = <T>(p: Promise<T>): Promise<T> =>
    new Promise<T>((resolve,reject)=>{
      const remaining=deadline-Date.now();
      if(remaining<=0){ p.catch(()=>{}); reject(codeError(TIMEOUT_MSG,"timeout")); return; }
      timeoutId=setTimeout(()=>reject(codeError(TIMEOUT_MSG,"timeout")),remaining);
      p.then(
        (v)=>{ clearTimeout(timeoutId); resolve(v); },
        (e)=>{ clearTimeout(timeoutId); reject(e); }
      );
    });
  let r: Response;
  try {
    r=await raceDeadline(fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ac.signal}));
  } catch (err) {
    if (signal) signal.removeEventListener("abort", onAbort);
    if ((err as Error).message === TIMEOUT_MSG) ac.abort();
    clearTimeout(timeoutId);
    throw err;
  }
  if(!r.ok){
    // The !r.ok body read is raced against the same deadline as everything
    // else (audit b244962): a stalled error body must not hang past the bound.
    // A deadline there is just a plain couldNotRun — the status is what the
    // UI keys on.
    let msg=copy.couldNotRun;
    try { const j=await raceDeadline(r.json()) as {error?:string}; if(j?.error)msg=j.error } catch {}
    if (signal) signal.removeEventListener("abort", onAbort);
    clearTimeout(timeoutId);
    const e=codeError(msg, "http_" + r.status) as Error & {status?:number};e.status=r.status;throw e;
  }
  if(!r.body){ if (signal) signal.removeEventListener("abort", onAbort); clearTimeout(timeoutId); throw codeError(copy.noBody,"empty_body"); }
  const rd=r.body.getReader(),dec=new TextDecoder();let b='';
  // Error-path hardening (Wizard A live QA round, 2026-08-11): a 200 with an
  // error-sized body (provider failure that never produced NDJSON events), an
  // empty stream, or a stream cut before the terminal event must NEVER leave
  // the UI streaming forever. Completion is tracked by the server's terminal
  // "done" event; the server's terminal "error" event is a complete response
  // too (ReviewTool renders it). Lines without a string type are skipped —
  // they're error payloads, never review blocks.
  // P0 (2026-08-12): the "done" event is DEFERRED until EOF. A terminal done
  // with zero usable content (server said success but delivered nothing) must
  // throw BEFORE the done handler runs — otherwise review_completed fires, the
  // value gate marks delivered, and the visitor stares at a silent dead-end
  // (QA ef5768a4). Content = any block event (section/para/item/rewrite/
  // rwtext); start is just the stream-open marker.
  let sawDone=false, sawError=false, sawContent=false, pendingDone: ReviewEvent | null = null;
  try { for(;;){
    const read=await raceDeadline(rd.read());
    const {done,value}=read;if(done)break;b+=dec.decode(value,{stream:true});let n;
    while((n=b.indexOf('\n'))>=0){const l=b.slice(0,n).trim();b=b.slice(n+1);if(l)try{const ev=JSON.parse(l) as ReviewEvent;if(ev&&typeof ev.type==="string"){
      if(ev.type==="done"){sawDone=true;pendingDone=ev;continue;}
      if(ev.type==="error")sawError=true;else if(ev.type!=="start")sawContent=true;
      onEvent(ev)
    }}catch{}}
  }} catch (err) {
    // On deadline the connection is aborted so the server refunds; the error the
    // UI sees stays calm (ReviewTool treats a real user AbortError as a quiet
    // stop, so we never surface "aborted" for a timeout).
    if ((err as Error).message === TIMEOUT_MSG) ac.abort();
    throw err;
  } finally { if (signal) signal.removeEventListener("abort", onAbort); clearTimeout(timeoutId); try{rd.releaseLock()}catch{} }
  if (sawDone) {
    // A 200 that ended with "done" but never delivered a single review block is
    // a FAILURE, not a success: calm error + retry, no completed event, no
    // value gate. (The server also refuses to emit done-empty now — this is
    // defense in depth for any legacy/rogue producer.) If an error event
    // already arrived, that IS the terminal state — don't double-report, and
    // never let a trailing done clobber an error that was already surfaced.
    if (!sawContent && !sawError) throw codeError(copy.eof, "empty_stream");
    if (!sawError && pendingDone) onEvent(pendingDone);
  } else if (!sawError) {
    // EOF without a terminal event: calm error + Retry (never a silent hang).
    throw codeError(copy.eof, "eof");
  }
}
export async function streamReview(draft:string,onEvent:(e:ReviewEvent)=>void,signal?:AbortSignal,opts?:{example?:boolean;attachments?:Attachment[]}){
  return streamNDJSON('/api/review',{draft,...(opts?.example?{example:true}:{}),...(opts?.attachments?.length?{attachments:opts.attachments}:{})},onEvent,signal,REVIEW_COPY);
}
export async function streamAnalyze(situation:string,onEvent:(e:ReviewEvent)=>void,signal?:AbortSignal,attachments?:Attachment[]){
  return streamNDJSON('/api/analyze',{situation,...(attachments?.length?{attachments}:{})},onEvent,signal,ANALYZE_COPY);
}
