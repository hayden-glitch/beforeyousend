import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { streamReview, streamAnalyze, type ReviewEvent, type Attachment } from "~/lib/api";
import { track } from "~/lib/analytics";
import { readCaptureVariant } from "~/lib/captureVariant";
import { useReviewTyping } from "~/lib/useReviewTyping";
import { markValueDelivered, recordSurface } from "~/lib/offer";
import { maybeStartTrial } from "~/lib/trial";
import { paymentSurfaceAvailable, runCheckout, type CheckoutOpening } from "~/lib/checkout";
import PaymentSurface from "~/components/PaymentSurface";
import ReviewResults, { type ResultBlock } from "~/components/ReviewResults";
import DidYouSendIt from "~/components/DidYouSendIt";
import Momentum from "~/components/Momentum";
import DigestCard from "~/components/DigestCard";
import { computeImpactScore } from "~/lib/impactScore";
import { scrollBehavior } from "~/lib/motion";
import { TONE_DISPLAY } from "~/lib/toneLabels";
import { folderLabel, subfolderLabel } from "~/lib/taxonomy";
import { TabBar, type TabKey } from "~/components/TabBar";
import ModeSwitch, { type ToolMode } from "~/components/ModeSwitch";
import AttachControl, { AttachChips } from "~/components/AttachControl";
import UserMenu from "~/components/UserMenu";
import TomorrowDraftsList from "~/components/TomorrowDraftsList";
import { IconArrowDown, IconArrowUp, IconClose, IconLog, IconOrganizer, IconPlus, IconTimeline } from "~/components/icons";
// Lazy-mounted so "The Organizer" trial UI ships as its own chunk — the main
// dashboard bundle stays small for the free-tier dad who never opens it.
const OrganizerTrial = lazy(() => import("~/components/OrganizerTrial"));
const Organizer = lazy(() => import("~/components/Organizer"));
const SortMyPile = lazy(() => import("~/components/SortMyPile"));
const CaseSummary = lazy(() => import("~/components/CaseSummary"));
const ActionCenter = lazy(() => import("~/components/ActionCenter"));
import OrganizerLocked from "~/components/OrganizerLocked";
import ToolsHub from "~/components/ToolsHub";
import RecordHealthPanel from "~/components/RecordHealth";
import type { ChildInfo } from "~/components/ChildFolder";
import CaseSummaryLocked from "~/components/CaseSummaryLocked";
import ActionCenterLocked from "~/components/ActionCenterLocked";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Your Command Center — Before You Send" },
      { name: "description", content: "Your Before You Send dashboard: message review, saved reviews, Communication Log, and Event Timeline in one calm place." },
    ],
  }),
  component: Dashboard,
});
type Status = "idle" | "streaming" | "done" | "error";
// Format an instant as the LOCAL wall-clock YYYY-MM-DDTHH:mm for datetime-local
// inputs. (toISOString().slice(0,16) yields UTC, which datetime-local renders as
// local — entries defaulted hours ahead and edits shifted the stored time.)
function localDT(d?: string | number | Date) {
  const dt = d === undefined ? new Date() : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
// 24-hour free trial indicator: whole hours left, floored at 1 (never "0h
// left" while still active — the moment it passes, authMe stops reporting it).
function trialHoursLeft(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!(ms > 0)) return null;
  return Math.max(1, Math.ceil(ms / 3600000));
}
const TOPICS = ["pickup/drop-off","schedule","child expenses","health","school","communication","legal","other"];
// Calm-loop tone display labels (the did-you-send tone picker writes these ids
// to bys_log.tone; "reviewed" is the pre-pick default and shows no chip).
const toneSuffix=(t?:string)=>t&&t!=="reviewed"?` · ${TONE_DISPLAY[t]||t}`:"";
function CommunicationLog({ onReviewReply, child, tier, catchUp, onCatchUpDone }: { onReviewReply?: (message: string) => void; child?: ChildInfo | null; tier?: string; catchUp?: any; onCatchUpDone?: () => void }){
 const [logs,setLogs]=useState<any[]>([]), [filter,setFilter]=useState("all"), [search,setSearch]=useState(""), [selected,setSelected]=useState<any>(null), [editing,setEditing]=useState(false), [form,setForm]=useState<any>({message:"",direction:"sent",date:localDT(),topic:"other",notes:"",tone:"",child:""}), [notice,setNotice]=useState("");
 const load=useCallback(async()=>{const r=await fetch("/api/log");if(r.ok)setLogs((await r.json()).logs||[])},[]); useEffect(()=>{load()},[load]);
 const reset=()=>{setSelected(null);setEditing(false);setForm({message:"",direction:"sent",date:localDT(),topic:"other",notes:"",tone:"",child:""})};
 // Record Health gap catch-up (spec §3f): "Log it now" deep-links here with the
 // quiet-week dates. Date defaults to the day after the gap ends; tone chips
 // are hidden; topic defaults to "other"; save = the normal POST /api/log.
 useEffect(()=>{if(catchUp){setSelected(null);setEditing(false);setNotice("");setForm({message:"",direction:"sent",date:`${catchUp.after}T00:00`,topic:"other",notes:"",tone:"",child:""});}},[catchUp]);
 const saveCatchUp=async()=>{if(!form.message.trim())return; const payload:any={...form,date:new Date(form.date).toISOString()}; if(form.tone)payload.tone=form.tone; if(form.child)payload.child=form.child; const r=await fetch("/api/log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); if(r.ok){setNotice(`Logged — ${catchUp.afterLabel} is on your record.`);reset();onCatchUpDone?.();load()}else setNotice("Could not save this entry.")};
 const save=async()=>{if(!form.message.trim())return; const url=editing&&selected?`/api/log/${selected.id}`:"/api/log"; const payload:any={...form,date:new Date(form.date).toISOString()}; if(editing&&selected){payload.tone=form.tone||"";payload.child=form.child||""}else{if(form.tone)payload.tone=form.tone;if(form.child)payload.child=form.child} const r=await fetch(url,{method:editing&&selected?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); if(r.ok){if(!editing&&form.child)track("log_child_tagged",{plan:tier||"free",child:form.child});if(!editing&&form.tone)track("manual_tone_picked",{tone:form.tone});setNotice(editing&&selected?"Entry updated.":"Entry added.");reset();load()}else setNotice("Could not save this entry.")};
 const remove=async()=>{if(!selected||!confirm("Delete this log entry?"))return; await fetch(`/api/log/${selected.id}`,{method:"DELETE",headers:{"Content-Type":"application/json"}});reset();load()};
 const beginEdit=()=>{if(!selected)return;setForm({...selected,date:localDT(selected.date),tone:["gentle","direct","firm","neutral"].includes(selected.tone)?selected.tone:"",child:selected.child||""});setEditing(true)};
 const shown=logs.filter(x=>filter==="all"||x.topic===filter).filter(x=>!search.trim()||(x.message||"").toLowerCase().includes(search.trim().toLowerCase()));
 if(catchUp)return <section className="mt-5"><div><h2 className="font-display text-2xl font-semibold text-forest">That quiet week</h2><p className="mt-1 text-base text-stone">Anything from {catchUp.fromLabel}–{catchUp.toLabel}? One line is enough.</p></div>
 <div className="card mt-4 p-5"><button onClick={()=>{onCatchUpDone?.();reset();}} className="min-h-11 text-base text-forest underline underline-offset-4">← Back to log</button><label className="field-label mt-4">Message text</label><textarea autoFocus rows={5} value={form.message} onChange={e=>setForm({...form,message:e.target.value})} placeholder={`Anything from ${catchUp.fromLabel}–${catchUp.toLabel}? One line is enough.`} className="min-h-32 w-full resize-y rounded-xl border border-line bg-cream p-4 text-base"/><label className="field-label mt-4">Direction</label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>setForm({...form,direction:"sent"})} className={`chip justify-center ${form.direction==="sent"?"border-forest bg-forest text-cream":""}`}><IconArrowUp className="h-4 w-4"/>Sent by me</button><button type="button" onClick={()=>setForm({...form,direction:"received"})} className={`chip justify-center ${form.direction==="received"?"border-forest bg-forest text-cream":""}`}><IconArrowDown className="h-4 w-4"/>Received</button></div><div className="mt-4"><label className="field-label">Date and time</label><input type="datetime-local" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} className="input"/></div><button onClick={saveCatchUp} disabled={!form.message.trim()} className="btn-primary mt-5 w-full">Log it</button>{notice&&<p className="mt-4 rounded-xl bg-cream-deep px-4 py-3 text-base text-stone" role="status">{notice}</p>}</div></section>;
 return <section className="mt-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold text-forest">Communication Log</h2><p className="mt-1 text-base text-stone">Every exchange, on the record.</p></div>{!selected&&!editing&&<button onClick={()=>setEditing(true)} className="btn-primary shrink-0 px-5"><IconPlus className="h-5 w-5"/>Add</button>}</div>
 {!selected&&!editing&&<><div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1"><label htmlFor="log-search" className="sr-only">Search messages</label><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-taupe" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input id="log-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search messages…" className="min-h-11 w-full rounded-[10px] border border-line bg-card py-2.5 pl-9 pr-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"/></div><select aria-label="Filter by topic" value={filter} onChange={e=>setFilter(e.target.value)} className="min-h-11 w-full rounded-[10px] border border-line bg-card px-3 py-2.5 text-base text-ink focus:border-forest-soft focus:outline-none sm:w-52"><option value="all">All topics ({logs.length})</option>{TOPICS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>{shown.length===0?<p className="card mt-4 p-5 text-base text-stone">{logs.length===0?"Nothing logged yet — when an exchange happens, add it here.":"Nothing matches that filter — try a different search or topic."}</p>:<div className="card mt-4 divide-y divide-line overflow-hidden">{shown.map(x=><button key={x.id} onClick={()=>setSelected(x)} className="block w-full px-5 py-4 text-left transition hover:bg-cream-deep/40"><span className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5 text-sm font-medium text-forest">{x.direction==="sent"?<><IconArrowUp className="h-4 w-4"/>Sent by me</>:<><IconArrowDown className="h-4 w-4"/>Received</>}</span><span className="shrink-0 text-sm text-taupe">{new Date(x.date).toLocaleDateString()}</span></span><p className="mt-1.5 line-clamp-2 text-base text-ink">{x.message}</p><span className="mt-1 block text-sm text-stone">{x.topic}{toneSuffix(x.tone)}{x.child&&child?.id===x.child?` · ${child?.name}`:null}</span></button>)}</div>}</>}
 {(selected&&!editing)&&<div className="card mt-4 p-5"><button onClick={reset} className="min-h-11 text-base text-forest underline">← Back to log</button><p className="mt-4 text-sm font-medium text-forest">{selected.direction==="sent"?"Sent by me":"Received from co-parent"}</p><p className="mt-1 text-sm text-taupe">{new Date(selected.date).toLocaleString()} · {selected.topic}{toneSuffix(selected.tone)}{selected.child&&child?.id===selected.child?` · ${child?.name}`:null}</p><p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-ink">{selected.message}</p>{selected.notes&&<div className="mt-4 rounded-xl bg-cream-deep p-4"><p className="text-sm font-semibold text-stone">PRIVATE NOTES</p><p className="mt-1 whitespace-pre-wrap text-base">{selected.notes}</p></div>}<div className="mt-5 flex flex-wrap gap-2"><button onClick={beginEdit} className="btn-primary flex-1">Edit</button><button onClick={()=>{onReviewReply?.(selected.message);setSelected(null)}} className="btn-ghost flex-1 text-forest">Review a reply →</button><button onClick={remove} className="btn-ghost flex-1 text-red-900">Delete</button></div></div>}
 {editing&&<div className="card mt-4 p-5"><button onClick={reset} className="min-h-11 text-base text-forest underline">← Cancel</button><label className="field-label mt-4">Message text</label><textarea autoFocus rows={5} value={form.message} onChange={e=>setForm({...form,message:e.target.value})} placeholder="What was said?" className="min-h-32 w-full resize-y rounded-xl border border-line bg-cream p-4 text-base"/><label className="field-label mt-4">Direction</label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>setForm({...form,direction:"sent"})} className={`chip justify-center ${form.direction==="sent"?"border-forest bg-forest text-cream":""}`}><IconArrowUp className="h-4 w-4"/>Sent by me</button><button type="button" onClick={()=>setForm({...form,direction:"received"})} className={`chip justify-center ${form.direction==="received"?"border-forest bg-forest text-cream":""}`}><IconArrowDown className="h-4 w-4"/>Received</button></div><label className="field-label mt-4">How did it read? <span className="font-normal text-stone">(optional)</span></label><div className="flex flex-wrap gap-2">{["gentle","direct","firm","neutral"].map(t=>(
    <button type="button" key={t} onClick={()=>setForm((f:any)=>({...f,tone:f.tone===t?"":t}))} className={`chip min-h-11 ${form.tone===t?"border-forest bg-forest text-cream":""}`}>{TONE_DISPLAY[t]}</button>
  ))}</div>{child?.id?<div className="mt-4"><button type="button" onClick={()=>{const next=form.child===child.id?"":child.id;setForm((f:any)=>({...f,child:f.child===child.id?"":child.id}));if(next)track("log_child_tagged",{plan:tier||"free",child:child.id})}} className={`chip min-h-11 ${form.child===child.id?"border-forest bg-forest text-cream":""}`}>For {child.name}</button></div>:null}<div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label className="field-label">Date and time</label><input type="datetime-local" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} className="input"/></div><div><label className="field-label">Topic</label><select value={form.topic} onChange={e=>setForm({...form,topic:e.target.value})} className="input">{TOPICS.map(t=><option key={t}>{t}</option>)}</select></div></div><label className="field-label mt-4">Private notes <span className="font-normal text-stone">(only visible to you)</span></label><textarea rows={3} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Add factual context for yourself…" className="w-full rounded-xl border border-line bg-cream p-4 text-base"/><button onClick={save} disabled={!form.message.trim()} className="btn-primary mt-5 w-full">{editing&&selected?"Save changes":"Add to log"}</button></div>}
 {notice&&<p className="mt-4 rounded-xl bg-cream-deep px-4 py-3 text-base text-stone" role="status">{notice}</p>}</section>;
}
const TIMELINE_CATEGORIES: [string,string][] = [["exchange","Exchange"],["school","School"],["medical","Medical"],["communication","Communication"],["court","Court & Legal"],["other","Other"]];
function fmtDate(d:string){const [y,m,dd]=d.split("-");if(!y||!m||!dd)return d;const dt=new Date(Number(y),Number(m)-1,Number(dd));return isNaN(dt.getTime())?d:dt.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}
function fmtDay(d:string){const [y,m,dd]=d.split("-");if(!y||!m||!dd)return d;const dt=new Date(Number(y),Number(m)-1,Number(dd));return isNaN(dt.getTime())?d:dt.toLocaleDateString(undefined,{month:"short",day:"numeric"})}
function monthLabel(key:string){const [y,m]=key.split("-");const d=new Date(Number(y),Number(m)-1,1);return isNaN(d.getTime())?key:d.toLocaleDateString(undefined,{month:"long",year:"numeric"})}
const KIND_TILES: [string,string,any][] = [["all","All",IconTimeline],["messages","Messages",IconLog],["incidents","Incidents",IconTimeline],["documents","Documents",IconOrganizer]];
type RecordItem = {
  kind: "incident" | "message" | "document";
  id: string;
  dateKey: string;   // YYYY-MM-DD for sort/group/dots
  title: string;
  sub: string;       // provenance line (category / direction·topic / folder›subfolder)
  body: string;      // details / message / snippet
  notes?: string;    // message private notes only
  src: any;          // original row for the detail view
};
// Same snippet logic as The Organizer's FileCard (Organizer.tsx): text → the
// content itself; image/PDF → summary || description || title || fallback.
function docSnippet(d: any): string {
  if (d.kind === "text") return (d.content || "").trim();
  return d.summary || d.description || d.title || "Photo, screenshot, or PDF";
}
// P2 Timeline Ribbon — "your record": the dad's own three streams (log
// messages, timeline incidents, organizer documents) merged into one calm
// strip. Counts come from his own rows via the existing per-user APIs; a
// failed read contributes an empty stream, never an error card. The Documents
// stream is fetched only on Command/Ultimate (the Organizer endpoint's 402
// gate); other tiers simply see no Documents tile — no lock card, no upsell.
// P2 Timeline Ribbon — "your record": the dad's own three streams (log
// messages, timeline incidents, organizer documents) merged into one calm
// strip. Counts come from his own rows via the existing per-user APIs; a
// failed read contributes an empty stream, never an error card. The Documents
// stream is fetched only on Command/Ultimate (the Organizer endpoint's 402
// gate); other tiers simply see no Documents tile — no lock card, no upsell.
//
// Rebuild per 5304729186 §6: chronology first. One compact kind-filter grid
// (2×2 at small widths, four-up only when geometry fits), incident categories
// only in the incidents view (clearly labeled "All incidents" so "All" never
// appears twice with conflicting meaning), and a restrained vertical date/rule
// structure — no decorative dot rows, no horizontal scrollers.
function EventTimeline({ tier, organizerAccess, onGoLog, onGoOrganizer, onReviewReply }: { tier: string; organizerAccess?: boolean; onGoLog: () => void; onGoOrganizer: () => void; onReviewReply?: (message: string) => void }) {
  const [items,setItems]=useState<any[]>([]), [logs,setLogs]=useState<any[]>([]), [docs,setDocs]=useState<any[]>([]);
  const [filter,setFilter]=useState("all"), [kind,setKind]=useState<"all"|"messages"|"incidents"|"documents">("all");
  const [selected,setSelected]=useState<any>(null), [editing,setEditing]=useState(false);
  const [form,setForm]=useState<any>({date:new Date().toISOString().slice(0,10),title:"",category:"other",details:""}), [notice,setNotice]=useState("");
  const ribbonViewFired=useRef(false);
  const suite=tier==="command"||tier==="ultimate";
  const load=useCallback(async()=>{
    const [tr,lg,dr]=await Promise.all([
      fetch("/api/timeline").then(r=>r.ok?r.json():Promise.reject()).then(j=>j.timeline||[]).catch(()=>[]),
      fetch("/api/log").then(r=>r.ok?r.json():Promise.reject()).then(j=>j.logs||[]).catch(()=>[]),
      (suite||organizerAccess)?fetch("/api/organizer/files").then(r=>r.ok?r.json():Promise.reject()).then(j=>j.files||[]).catch(()=>[]):Promise.resolve([]),
    ]);
    setItems(tr);setLogs(lg);setDocs(dr);
  },[suite,organizerAccess]);
  useEffect(()=>{load()},[load]);
  const reset=()=>{setSelected(null);setEditing(false);setForm({date:new Date().toISOString().slice(0,10),title:"",category:"other",details:""})};
  const save=async()=>{if(!form.title.trim())return; const url=editing&&selected?`/api/timeline/${selected.id}`:"/api/timeline"; const r=await fetch(url,{method:editing&&selected?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)}); if(r.ok){setNotice(editing&&selected?"Entry updated.":"Entry added.");if(!(editing&&selected))track("timeline_entry_added",{category:form.category});reset();load()}else setNotice("Could not save this entry.")};
  const remove=async()=>{if(!selected||!confirm("Delete this entry?"))return; await fetch(`/api/timeline/${selected.id}`,{method:"DELETE",headers:{"Content-Type":"application/json"}});reset();load()};
  const beginEdit=()=>{if(!selected)return;setForm({date:(selected.date||"").slice(0,10)||new Date().toISOString().slice(0,10),title:selected.title||"",category:selected.category||"other",details:selected.details||""});setEditing(true)};
  const catLabel=(c:string)=>TIMELINE_CATEGORIES.find(([k])=>k===c)?.[1]||c;
  // Merge the three streams (per-user rows only) and sort newest first.
  const merged: RecordItem[] = useMemo(() => {
    const out: RecordItem[] = [];
    for (const x of items) out.push({ kind:"incident", id:x.id, dateKey:(x.date||"").slice(0,10), title:x.title, sub:catLabel(x.category), body:x.details||"", src:x });
    for (const x of logs) out.push({ kind:"message", id:x.id, dateKey:localDT(x.date).slice(0,10), title:x.message, sub:`${x.direction==="sent"?"Sent by me":"Received"} · ${x.topic}${toneSuffix(x.tone)}`, body:x.message, notes:x.notes, src:x });
    for (const x of docs) out.push({ kind:"document", id:x.id, dateKey:localDT(x.createdAt).slice(0,10), title:x.title||x.summary||docSnippet(x), sub:`${folderLabel(x.folder)} › ${subfolderLabel(x.folder, x.category)}`, body:docSnippet(x), src:x });
    return out.sort((a,b)=>String(b.dateKey).localeCompare(String(a.dateKey)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[items,logs,docs]);
  const counts = { all: merged.length, messages: logs.length, incidents: items.length, documents: docs.length };
  const total = merged.length;
  // ribbon_view fires once per mount (ref guard, same pattern as captureViewFired).
  useEffect(()=>{
    if(!ribbonViewFired.current && total>0){ribbonViewFired.current=true;track("timeline_ribbon_view",{plan:tier});}
  },[total,tier]);
  // kind filter first, then the category filter (incidents only — a message or
  // document has no category).
  const shown = merged.filter(m=>{
    if(kind==="messages") return m.kind==="message";
    if(kind==="incidents") return m.kind==="incident";
    if(kind==="documents") return m.kind==="document";
    return true;
  }).filter(m=>{
    if(filter==="all"||m.kind!=="incident") return true;
    return m.src.category===filter;
  });
  const groups:{key:string;rows:RecordItem[]}[]=[]; const byMonth=new Map<string,RecordItem[]>();
  for(const it of shown){const key=it.dateKey.slice(0,7)||"nodate"; if(!byMonth.has(key))byMonth.set(key,[]); byMonth.get(key)!.push(it)}
  for(const [key,rows] of byMonth)groups.push({key,rows});
  const showIncidentChrome = kind==="all"||kind==="incidents";
  return <section className="mt-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold text-forest">Event Timeline</h2><p className="mt-1 text-base text-stone">The moments that matter, in order.</p></div>{!selected&&!editing&&showIncidentChrome&&<button onClick={()=>setEditing(true)} className="btn-primary shrink-0 px-5"><IconPlus className="h-5 w-5"/>Add</button>}</div>
  {total>0&&!selected&&!editing&&<div className="mt-4 grid grid-cols-2 gap-1.5 md:grid-cols-4" role="group" aria-label="Filter your record">
    {KIND_TILES.filter(([k]) => suite || k !== "documents").map(([k, label, Icon]) => (
      <button key={k} type="button" onClick={() => { setKind(k as any); track("timeline_ribbon_filter", { kind: k }); }}
        className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border px-2 py-2 text-sm font-medium transition-colors duration-150 ${kind === k ? "border-forest/45 bg-forest/10 text-forest" : "border-line bg-card text-stone hover:border-forest/25"}`}>
        <Icon className="h-4 w-4 shrink-0" />{label}<span className="ml-0.5 tabular-nums">{counts[k as keyof typeof counts]}</span>
      </button>
    ))}
  </div>}
  {suite&&!selected&&!editing&&<RecordHealthPanel tier={tier} compact refreshKey={total}/>}
  {!selected&&!editing&&<>{kind==="incidents"&&<div className="mt-3 flex flex-wrap gap-1.5"><button onClick={()=>setFilter("all")} className={`chip min-h-11 px-3.5 py-2 text-sm ${filter==="all"?"border-forest bg-forest text-cream":""}`}>All incidents ({items.length})</button>{TIMELINE_CATEGORIES.map(([k,l])=><button key={k} onClick={()=>setFilter(k)} className={`chip min-h-11 px-3.5 py-2 text-sm ${filter===k?"border-forest bg-forest text-cream":""}`}>{l}</button>)}</div>}
  {shown.length===0?<p className="card mt-4 p-5 text-base text-stone">{kind==="messages"?(<>No messages in your record yet. <button type="button" onClick={onGoLog} className="font-semibold text-forest underline underline-offset-4">Open the Communication Log →</button></>):kind==="incidents"?"No incidents here yet.":kind==="documents"?"No documents here yet.":"Nothing recorded yet. Add pickup problems, school incidents, medical visits, court dates — anything worth remembering."}</p>:<div className="mt-5 space-y-6">{groups.map(g=><div key={g.key}><h3 className="text-sm font-semibold uppercase tracking-[.14em] text-forest-soft">{monthLabel(g.key)}</h3><div className="mt-2 divide-y divide-line/70 border-t border-line/70">{g.rows.map(m=>(<button key={m.id} onClick={()=>{if(m.kind==="incident"){setSelected(m.src);}else{setSelected(m);track("timeline_item_view",{kind:m.kind});}}} className="flex w-full items-start gap-3 px-1 py-3 text-left transition hover:bg-cream-deep/40 sm:px-2"><span className="w-14 shrink-0 pt-0.5 text-sm text-taupe">{fmtDay(m.dateKey)}</span><span className="min-w-0 flex-1"><span className="block line-clamp-1 font-medium text-ink">{m.title}</span><span className="mt-0.5 block truncate text-sm text-stone">{m.sub}</span></span>{kind==="all"&&<span className="mt-0.5 shrink-0 rounded-md border border-line bg-cream-deep px-2 py-0.5 text-xs font-medium text-taupe">{m.kind==="incident"?"Incident":m.kind==="message"?"Message":"Document"}</span>}</button>))}</div></div>)}</div>}</>}
  {(selected&&!editing)&&((selected.kind==="message"||selected.kind==="document")?(<div className="card mt-4 p-5"><button onClick={reset} className="min-h-11 text-base text-forest underline">← Back to timeline</button>
    {selected.kind==="message"?(<><p className="mt-4 text-sm font-medium text-forest">{selected.sub}</p><p className="mt-1 text-sm text-taupe">{new Date(selected.src.date).toLocaleString()}</p><p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-ink">{selected.src.message}</p>{selected.notes&&<div className="mt-4 rounded-xl bg-cream-deep p-4"><p className="text-sm font-semibold text-stone">PRIVATE NOTES</p><p className="mt-1 whitespace-pre-wrap text-base">{selected.notes}</p></div>}<div className="mt-5 flex flex-wrap gap-2"><button onClick={()=>{onReviewReply?.(selected.src.message);setSelected(null)}} className="btn-ghost flex-1 whitespace-nowrap text-forest">Review a reply →</button></div></>):(<><h3 className="mt-4 font-display text-2xl font-semibold leading-snug text-forest">{selected.src.title || (selected.src.kind === "text" ? "Pasted text" : "Photo, screenshot, or PDF")}</h3><p className="mt-1 text-sm text-stone">{selected.sub}</p><p className="mt-1 text-sm text-taupe">Added {fmtDate(selected.dateKey)}</p>{selected.src.summary&&<p className="mt-4 text-base leading-relaxed text-ink">{selected.src.summary}</p>}{selected.src.tags&&selected.src.tags.length>0&&<div className="mt-3 flex flex-wrap gap-1.5">{selected.src.tags.map((t:string)=><span key={t} className="rounded-md border border-line bg-cream-deep px-2.5 py-0.5 text-xs font-medium text-stone">{t}</span>)}</div>}<p className="mt-4 rounded-xl bg-cream-deep/60 p-4 text-sm leading-relaxed text-ink">{selected.body}</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={()=>{onGoOrganizer();setSelected(null)}} className="btn-ghost flex-1 whitespace-nowrap text-forest">View in The Organizer →</button></div></>)}
  </div>):(<div className="card mt-4 p-5"><button onClick={reset} className="min-h-11 text-base text-forest underline">← Back to timeline</button><p className="mt-4 text-sm text-taupe">{fmtDate(selected.date)} · {catLabel(selected.category)}</p><h3 className="mt-1 font-display text-2xl font-semibold leading-snug text-forest">{selected.title}</h3>{selected.details&&<p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-ink">{selected.details}</p>}<div className="mt-5 flex gap-2"><button onClick={beginEdit} className="btn-primary flex-1">Edit</button><button onClick={remove} className="btn-ghost flex-1 text-red-900">Delete</button></div></div>))}
  {editing&&<div className="card mt-4 p-5"><button onClick={reset} className="min-h-11 text-base text-forest underline">← Cancel</button><label className="field-label mt-4">Date</label><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} className="input"/><label className="field-label mt-4">Title</label><input type="text" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} maxLength={200} placeholder="What happened?" className="input"/><label className="field-label mt-4">Category</label><div className="flex flex-wrap gap-1.5">{TIMELINE_CATEGORIES.map(([k,l])=><button key={k} type="button" onClick={()=>setForm({...form,category:k})} className={`chip min-h-11 px-3.5 py-2 text-sm ${form.category===k?"border-forest bg-forest text-cream":""}`}>{l}</button>)}</div><label className="field-label mt-4">Details <span className="font-normal text-stone">(optional, only visible to you)</span></label><textarea rows={4} value={form.details} onChange={e=>setForm({...form,details:e.target.value})} placeholder="A few factual notes: who, what, when, where…" className="w-full rounded-xl border border-line bg-cream p-4 text-base"/><button onClick={save} disabled={!form.title.trim()} className="btn-primary mt-5 w-full">{editing&&selected?"Save changes":"Add to timeline"}</button></div>}
  {notice&&<p className="mt-4 rounded-xl bg-cream-deep px-4 py-3 text-base text-stone" role="status">{notice}</p>}</section>;
}
function Dashboard(){
 const nav=useNavigate(); const [user,setUser]=useState<any>(null); const [authState,setAuthState]=useState<"checking"|"ready"|"error">("checking"); const [authRetry,setAuthRetry]=useState(0); const [tab,setTab]=useState<string>(()=>{try{const q=new URLSearchParams(window.location.search);const t=q.get("tab");const sort=q.get("sort")==="1";if(sort&&(t==="organizer"||t==="sort"))return "sort";return t==="case"||t==="action"||t==="organizer"||t==="sort"||t==="log"||t==="timeline"||t==="saved"||t==="tools"||t==="ai"?t:"ai"}catch{return "ai"}}); const [draft,setDraft]=useState(""); const [blocks,setBlocks]=useState<ResultBlock[]>([]); const [mode,setMode]=useState<"live"|"demo">("live"); const [status,setStatus]=useState<Status>("idle"); const [error,setError]=useState(""); const [saved,setSaved]=useState<any[]>([]); const [notice,setNotice]=useState(""); const [justSaved,setJustSaved]=useState(false); const reviewingRef=useRef(false); const [attachments,setAttachments]=useState<Attachment[]>([]);
 // Record Health gap catch-up (spec §3f): the amber gap card's "Log it now"
 // deep-links to the Log tab with this quiet-week payload; the catch-up sheet
 // renders in CommunicationLog until logged or dismissed.
 const [catchUp,setCatchUp]=useState<any>(null);
 // Record Health "Not that one" dismissals (spec §1): hoisted here so a
 // dismissed missing-doc card stays gone for the whole session across tab
 // switches and Organizer remounts; a page reload resets it (may return).
 const [rhDismissed,setRhDismissed]=useState<Record<string,boolean>>({});
 // Two-mode AI Co-Parent (2026-08-11): tool + per-mode state. The shared
 // draft/blocks/status/error ARE the active mode's state; switching saves the
 // active mode into modeBackupRef and restores the other mode's — drafts and
 // finished results survive both ways. abortRef lets a mid-stream switch abort
 // the stream (server refunds the slot; the stream's catch treats AbortError
 // as a quiet stop). streamToolRef knows which mode the current stream belongs
 // to (so done-events fire analyze_completed vs review_completed correctly).
 const [tool,setTool]=useState<ToolMode>(()=>{try{return new URLSearchParams(window.location.search).get("mode")==="analyze"?"analyze":"review"}catch{return "review"}});
 const toolRef=useRef(tool); useEffect(()=>{toolRef.current=tool},[tool]);
 const modeBackupRef=useRef<{review:{draft:string;blocks:ResultBlock[];status:Status;error:string};analyze:{draft:string;blocks:ResultBlock[];status:Status;error:string}}>({review:{draft:"",blocks:[],status:"idle",error:""},analyze:{draft:"",blocks:[],status:"idle",error:""}});
 const abortRef=useRef<AbortController|null>(null);
 const streamToolRef=useRef<ToolMode>("review");
 const PROMPT_CHIPS:{label:string;prefix:string}[]=[{label:"What happened",prefix:"What happened: "},{label:"What they said or did",prefix:"What they said or did: "},{label:"What you want next",prefix:"What you want next: "}];
 function appendChip(prefix:string){const cur=draft;const sep=cur.trim()&&!/\n$/.test(cur)?"\n":"";setDraft(cur+sep+prefix);requestAnimationFrame(()=>{const el=document.getElementById("home-draft") as HTMLTextAreaElement|null;if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length)}})}
 function switchTool(m:ToolMode){if(m===toolRef.current)return;if(status==="streaming"){abortRef.current?.abort();abortRef.current=null;modeBackupRef.current[toolRef.current]={draft,blocks:[],status:"idle",error:""};}else{modeBackupRef.current[toolRef.current]={draft,blocks,status,error:""};}toolRef.current=m;setTool(m);const b=modeBackupRef.current[m];setDraft(b.draft);setBlocks(b.blocks);setStatus(b.status);setError(b.error);setLandingText("");setJustSaved(false);eventPostedRef.current=true;setDidYouSendFresh(false);setCalmKey(k=>k+1);setCalm({eventId:null,score:null});track("mode_switched",{mode:m})}
 const [pwOpen,setPwOpen]=useState(false); const [pw,setPw]=useState(""); const [pwBusy,setPwBusy]=useState(false); const [pwMsg,setPwMsg]=useState(""); const [pwDone,setPwDone]=useState(false);
 // Landing-sourced saved reviews (email-capture flow) carry the full review
 // text in r.review with no block structure — this renders it read-only.
 const [landingText,setLandingText]=useState("");
 // Calm-loop slice 1: review-event persistence (one row per completed review
 // → Momentum week count + trend) and the did-you-send card. calmKey remounts
 // DidYouSendIt per review so its ask state resets cleanly; eventPostedRef
 // guards the fire-and-forget POST (once per completion, never on re-render).
 const [calm,setCalm]=useState<{eventId?:string|null;score:number|null}>({eventId:null,score:null});
 const [calmKey,setCalmKey]=useState(0);
 const [momentum,setMomentum]=useState<{weekCount:number;recent:any[]}|null>(null);
 const [digest,setDigest]=useState<any>(null);
 // Record Review (Stage 2, 2026-08-13): card + report state. rrReport is the
 // last generated report (re-viewed when Tools opens, refreshed after a
 // generate); rrEntState is the freshest server entitlement (from the POST
 // response — an Ultimate generate flips the card to "used" without a
 // /api/auth/me round-trip); rrBusy/rrErr are the one-step action states.
 const [rrReport,setRrReport]=useState<any>(null);
 const [rrEntState,setRrEntState]=useState<any>(null);
 const [rrBusy,setRrBusy]=useState(false);
 const [rrErr,setRrErr]=useState("");
 const rrEnt=rrEntState||user?.entitlements?.recordReview||{entitled:false,kind:"none"};
 const rrUsed=!rrEnt.entitled&&!!rrEnt.nextAvailableAt;
 const eventPostedRef=useRef(false);
 // M1: the did-you-send card belongs to the review JUST completed — never to a
 // saved review reopened later (no nagging, no fabricated today-dated "sent"
 // log entry for an old message). Set true only in handle "start" / review();
 // false in open().
 const [didYouSendFresh,setDidYouSendFresh]=useState(false);
 // L9: the card logs the REVIEWED draft, not the live textarea (the dad may
 // edit the textarea after completion before answering the card).
 const reviewedDraftRef=useRef("");
 const score=useMemo(()=>tool==="review"&&blocks.length?computeImpactScore(blocks).score:null,[blocks,tool]);
 const { onActivity: onTyping, clear: clearTyping } = useReviewTyping();
 // Auth gate (A1×B1, owner's auto-logout report 75fa1a07): /api/auth/me is the
 // session verdict. Redirect to "/" ONLY on a true no-session 401 ({user:null}
 // in the body). 5xx or a network error retries once after ~1.5s; if the retry
 // also fails we render a calm in-page error with a Retry button — never a
 // redirect, never a logged-out-looking dashboard. While the check is pending
 // the dashboard shows a minimal loading state instead of "Good to see you,
 // there." / Plan: Free.
 useEffect(()=>{
   let cancelled=false;
   const apply=async(r:Response):Promise<"ok"|"retry"|"gone">=>{
     if(r.status===401){const j=await r.json().catch(()=>({user:null}));return j&&j.user==null?"gone":"retry";}
     if(!r.ok)return "retry";
     const j=await r.json().catch(()=>null);
     if(!j||!j.user)return "retry";
     setUser({...(j.user||{}),quota:j.quota,organizerTrial:j.organizerTrial,organizerFiles:j.organizerFiles,entitlements:j.entitlements});
     loadSaved();
     return "ok";
   };
   const settle=(res:"ok"|"retry"|"gone")=>{
     if(res==="gone"){
       // Conversion-tracking Fix 3 (audit 85fbc48d): the auth gate bounces a
       // signed-out /home to / — set the same suppress flag as the ttclid hop so
       // a page_view never counts a route that never rendered, then clear it once
       // the navigation lands (never poison the next full page load).
       try { sessionStorage.setItem("bys_ttclid_redirect","1"); } catch {}
       const p:unknown=nav({to:"/"});
       if(p&&typeof (p as Promise<void>).finally==="function"){
         (p as Promise<void>).finally(()=>{ try { sessionStorage.removeItem("bys_ttclid_redirect"); } catch {} });
       }
       return;
     }
     if(res==="retry"){setAuthState("error");return;}
     setAuthState("ready");
   };
   (async()=>{
     try{
       let res=await apply(await fetch("/api/auth/me",{signal:AbortSignal.timeout(8000)}));
       if(res==="retry"){
         await new Promise(r2=>setTimeout(r2,1500));
         if(cancelled)return;
         res=await apply(await fetch("/api/auth/me",{signal:AbortSignal.timeout(8000)}));
       }
       if(cancelled)return;
       settle(res);
     }catch{
       try{
         await new Promise(r2=>setTimeout(r2,1500));
         if(cancelled)return;
         settle(await apply(await fetch("/api/auth/me",{signal:AbortSignal.timeout(8000)})));
       }catch{
         if(!cancelled)setAuthState("error");
       }
     }
   })();
   return ()=>{cancelled=true};
 },[authRetry]);
 // Calm-loop: momentum fetch (week count + last-3 trend) on mount, and again
 // after each completed review's event POST lands so the card stays current.
 const loadMomentum=useCallback(async()=>{const r=await fetch("/api/review-events");if(r.ok){const j=await r.json();setMomentum({weekCount:j.week?.count??0,recent:j.recent??[]})}},[]);
 // Calm-loop slice 2: weekly digest (Steady+). 402 on the free tier is fine —
 // the card render is gated on effective tier anyway; a stale/empty week hides
 // the card entirely (never an empty-state that pressures).
 const loadDigest=useCallback(async()=>{const r=await fetch("/api/digest");if(r.ok)setDigest(await r.json())},[]);
 // Record Review re-view: opening the Tools tab fetches the account's last
 // generated report as-is (no regeneration — the stored HTML is served back).
 useEffect(()=>{
   if(tab!=="tools"||authState!=="ready"||rrReport)return;
   let cancelled=false;
   fetch("/api/record-review").then((r)=>r.ok?r.json():null).then((j)=>{if(!cancelled&&j&&j.report)setRrReport(j.report);}).catch(()=>{});
   return ()=>{cancelled=true};
 },[tab,authState,rrReport]);
 useEffect(()=>{loadMomentum()},[loadMomentum]);
 useEffect(()=>{loadDigest()},[loadDigest]);
 // Review-event persistence: one POST per completed real dashboard review
 // (fire-and-forget — never blocks the results UI; the score card and the
 // did-you-send card work even if this fails; only streak/trend skip the row).
 useEffect(()=>{
   if(status!=="done"||!blocks.length||landingText||eventPostedRef.current||mode==="demo"||tool!=="review")return;
   eventPostedRef.current=true;
   reviewedDraftRef.current=draft;
   const id=crypto.randomUUID();
   fetch("/api/review-events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,draft,blocks})})
     .then(async r=>{const j=await r.json().catch(()=>({}));if(r.ok&&j.ok)setCalm({eventId:id,score:computeImpactScore(blocks).score});else setCalm({eventId:null,score:computeImpactScore(blocks).score});loadMomentum();loadDigest()})
     .catch(()=>{setCalm({eventId:null,score:computeImpactScore(blocks).score})});
 },[status,blocks,landingText,loadMomentum,mode,draft,tool]);
 async function loadSaved(){const r=await fetch("/api/reviews");if(r.ok)setSaved((await r.json()).reviews||[])}
 async function deleteAccount(){
   if(!window.confirm("Delete your account permanently? This removes your saved reviews, communication log, and event timeline. It can't be undone.")) return;
   const r=await fetch("/api/account",{method:"DELETE"});
   if(r.ok){setNotice("Your account and data have been deleted. Take care, and come back anytime.");setTimeout(()=>nav({to:"/"}),1600)}
   else{const j=await r.json().catch(()=>({}));setNotice(j.error||"Couldn't delete the account right now — please try again.")}
 }
 // Quiet "Set a password" item (optional, tiny ask — not a wall): session-only
 // set-password via /api/auth/password with NO token (server authenticates the
 // session itself — the session already IS the account, no takeover surface).
 async function setDashboardPassword(){
   if(pw.length<8){ setPwMsg("Use at least 8 characters."); return; }
   setPwBusy(true); setPwMsg("");
   try {
     const r=await fetch("/api/auth/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
     const j=await r.json().catch(()=>({}));
     if(!r.ok){ setPwMsg(j.error||"Could not set the password right now."); setPwBusy(false); return; }
     track("password_set",{});
     setPwDone(true); setPwOpen(false); setPwMsg("");
     setUser((u:any)=>({...u,hasPassword:true}));
     setPwBusy(false);
   } catch { setPwMsg("Could not reach the server right now — try again."); setPwBusy(false); }
 }
 const handle=useCallback((ev:ReviewEvent)=>{if(ev.type==="start"){setMode(ev.mode);setStatus("streaming");setBlocks([]);setLandingText("");eventPostedRef.current=false;setDidYouSendFresh(true);setCalmKey(k=>k+1);setCalm({eventId:null,score:null});window.dispatchEvent(new CustomEvent("bys:review-streaming"))}else if(ev.type==="done"){setStatus("done");markValueDelivered();const _cv=readCaptureVariant();if(streamToolRef.current==="analyze"){track("analyze_completed",{auth:"account"})}else{track("review_completed",_cv?{auth:"account",variant:_cv,mode:"review"}:{auth:"account",mode:"review"})}window.dispatchEvent(new CustomEvent("bys:checkin-value"))}else if(ev.type==="error"){setStatus("error");setError(ev.message)}else{const {type,...rest}=ev;setBlocks(p=>[...p,{kind:type,...rest} as ResultBlock])}},[]);
 async function review(){if(!draft.trim()||status==="streaming"||reviewingRef.current)return;reviewingRef.current=true;setError("");setBlocks([]);setLandingText("");setStatus("streaming");setJustSaved(false);eventPostedRef.current=false;setDidYouSendFresh(true);setCalmKey(k=>k+1);setCalm({eventId:null,score:null});streamToolRef.current="review";track("review_started",{auth:"account",mode:"review"});try{await streamReview(draft.trim(),handle,undefined,{...(attachments.length?{attachments}:{})})}catch(err){setStatus("error");setError(err instanceof Error&&err.message?err.message:"The review didn't come through. Try again.")}finally{reviewingRef.current=false}}
 async function analyze(){if(!draft.trim()||status==="streaming"||reviewingRef.current)return;reviewingRef.current=true;setError("");setBlocks([]);setLandingText("");setStatus("streaming");setJustSaved(false);eventPostedRef.current=true;setDidYouSendFresh(false);streamToolRef.current="analyze";track("analyze_started",{auth:"account"});try{await streamAnalyze(draft.trim(),handle,undefined,attachments)}catch(err){setStatus("error");setError(err instanceof Error&&err.message?err.message:"The analysis didn't come through. Try again.")}finally{reviewingRef.current=false}}
 async function save(){const kind=tool==="analyze"?"analysis":"review";const r=await fetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({draft,blocks,kind,review:blocks.map(b=>"text" in b?b.text:"").filter(Boolean).join("\n")})});if(r.ok){setJustSaved(true);setNotice("");if(kind==="analysis")track("analysis_saved",{plan:tier});loadSaved()}else setNotice(kind==="analysis"?"Could not save this analysis yet.":"Could not save this review yet.")}
 const [payOutcome,setPayOutcome]=useState<CheckoutOpening|null>(null);
 async function buyTopUp(){setNotice("");track("quota_cta_click",{});recordSurface("quota_cta");const outcome=await runCheckout({plan:"topup",source:"home",onError:(m)=>setNotice(m||"Checkout is not available right now.")});if(outcome.state==="opening"){if(paymentSurfaceAvailable(outcome)){setPayOutcome(outcome);return;}if(outcome.url)location.href=outcome.url;}}
 function open(r:any){const openKind=r.kind==="analysis"?"analyze":"review";if(openKind!==toolRef.current){modeBackupRef.current[toolRef.current]={draft,blocks,status:status==="streaming"?"idle":status,error:""};toolRef.current=openKind;setTool(openKind);}setDraft(r.draft||"");setBlocks(r.blocks||[]);const lt=!(r.blocks||[])?.length&&r.review?r.review:"";setLandingText(lt);setStatus(lt?"done":(r.blocks?.length?"done":"idle"));setTab("ai");setJustSaved(false);eventPostedRef.current=true;setDidYouSendFresh(false);setCalmKey(k=>k+1);setCalm({eventId:null,score:null});setNotice("")}
 const [renameId,setRenameId]=useState<string|null>(null);const [renameDraft,setRenameDraft]=useState("");const [renameBusy,setRenameBusy]=useState(false);
 async function renameReview(id:string){const t=renameDraft.trim().slice(0,120);if(!t)return;setRenameBusy(true);try{const r=await fetch("/api/reviews",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,title:t})});const j=await r.json().catch(()=>({}));if(r.ok){setSaved((prev:any[])=>prev.map((x:any)=>x.id===id?{...x,title:t}:x));setRenameId(null);setNotice("");}else{setNotice(typeof j?.error==="string"?j.error:"Couldn't rename that review right now.");}setRenameBusy(false);}catch{setRenameBusy(false);setNotice("Couldn't rename that review right now.")}}
 async function remove(id:string){try{const r=await fetch("/api/reviews",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});if(!r.ok){const j=await r.json().catch(()=>({}));setNotice(typeof j?.error==="string"?j.error:"Couldn't delete that review right now — please try again.");return}setNotice("");loadSaved()}catch{setNotice("Couldn't reach the server right now — try again.")}}
 const show=blocks.length>0||!!landingText||status==="streaming"||status==="done"||status==="error";
 const tier=user?.quota?.tier||user?.profile?.tier||"free"; const suiteUnlocked=tier==="command"||tier==="ultimate";
 const sortUntilActive=!!user?.profile?.sortUntil&&new Date(user.profile.sortUntil).getTime()>Date.now();
 // Sort My Pile buyers get the LIVE Organizer for 30 days (sortUntil) — same
 // access as Command/Ultimate for the Organizer tab + merged timeline, but NOT
 // the rest of the Command Center suite (Case Summary/Action/Export stay gated).
 const organizerUnlocked=suiteUnlocked||sortUntilActive;
 const hasOrgFiles=!!user?.organizerFiles?.hasAny;
 const organizerReadable=organizerUnlocked||hasOrgFiles;
 const organizerLapsed=!organizerUnlocked&&hasOrgFiles;
 const canExport=suiteUnlocked||hasOrgFiles;
 // Attachments (Steady+): effective tier gates paperclip vs ghost chip. The
 // dashboard is always authenticated, so the enticement sheet is always the
 // free-account variant.
 const canAttach=tier==="steady"||tier==="command"||tier==="ultimate";
 // FRONT B: the child folder's owner = profile.children[0]; home owns the
 // state update so the folder re-renders the instant "Make it theirs" lands.
 const children=Array.isArray(user?.profile?.children)?user.profile.children:[];
 const child=children[0]??null;
 // Batch 2: the server is the source of truth for children (it assigns and
 // preserves each child's stable id) — onChildSave/removeChild adopt the
 // server's children array wholesale, so ids never drift client-side.
 const onChildSave=(kids:any[])=>setUser((u:any)=>({...u,profile:{...(u?.profile||{}),children:kids}}));
 const removeChild=(kids:any[])=>setUser((u:any)=>({...u,profile:{...(u?.profile||{}),children:kids}}));
 // Export pack (Command Center): one calm tap downloads the dad's OWN record —
 // saved reviews, log, timeline, organizer documents, and case summary — as a
 // single HTML file from /api/export (tier-gated server-side too). Quiet
 // in-flight state, calm confirmation, export_failed on any error.
 const [exportBusy,setExportBusy]=useState(false);
 async function exportRecord(){
  if(exportBusy)return;
  setExportBusy(true);setNotice("");
  track("export_started",{plan:tier});
  try{
   const r=await fetch("/api/export",{method:"GET"});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||"Couldn't prepare your record right now.")}
   const blob=await r.blob();
   const cd=r.headers.get("Content-Disposition")||"";
   const m=cd.match(/filename="?([^";]+)"?/);
   const fname=m?m[1]:"Before-You-Send-Record.html";
   const url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download=fname;document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),4000);
   setExportBusy(false);
   track("export_downloaded",{plan:tier});
   setNotice("Your record is downloaded.");
  }catch(e){
   setExportBusy(false);
   track("export_failed",{plan:tier});
   setNotice(e instanceof Error&&e.message?e.message:"Couldn't prepare your record right now — please try again.");
  }
 }
 // Attorney Prep Pack (one-time $24.50, Stage 2): the durable grant (Ultimate
 // OR profile.attorneyPrep) is the entitlement — generation is on demand each
 // click, /api/attorney-pack assembles the self-contained HTML from his OWN
 // record (cover sheet, chronology, evidence index, communication patterns,
 // full record bundle). Server-side entitlement gate; calm busy state; any
 // error shows inline and the same button retries. Deterministic fallback on
 // the server means this should almost never fail.
 const attorneyPrepUnlocked=!!user?.entitlements?.attorneyPrep;
 const [packBusy,setPackBusy]=useState(false); const [packMsg,setPackMsg]=useState("");
 async function generatePack(){
  if(packBusy)return;
  setPackBusy(true);setPackMsg("");setNotice("");
  track("attorney_pack_started",{plan:tier});
  try{
   const r=await fetch("/api/attorney-pack",{method:"GET"});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||"Couldn't prepare your pack right now.")}
   const blob=await r.blob();
   const cd=r.headers.get("Content-Disposition")||"";
   const m=cd.match(/filename="?([^";]+)"?/);
   const fname=m?m[1]:"Attorney-Prep-Pack.html";
   const url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download=fname;document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),4000);
   setPackBusy(false);
   track("attorney_pack_downloaded",{plan:tier});
   setNotice("Your Attorney Prep Pack is downloaded.");
  }catch(e){
   setPackBusy(false);
   track("attorney_pack_failed",{plan:tier});
   setPackMsg(e instanceof Error&&e.message?e.message:"Couldn't prepare your pack right now — please try again.");
  }
 }
 // Record Review (Stage 2) actions: one-step generate (busy "Reviewing your
 // record…"), calm error + retry, and the self-contained HTML download of the
 // report already in the DOM (the same string as the in-app view).
 const runRecordReview=async()=>{
   setRrBusy(true);setRrErr("");track("record_review_started",{plan:tier});
   try{
     const r=await fetch("/api/record-review",{method:"POST"});
     const j=await r.json().catch(()=>null);
     if(!r.ok){
       if(j&&j.nextAvailableAt)setRrEntState({entitled:false,kind:"none",nextAvailableAt:j.nextAvailableAt});
       setRrErr((j&&j.error)||"We couldn't run the review right now — please try again.");
       track("record_review_failed",{plan:tier});
       return;
     }
     if(j&&j.report){setRrReport(j.report);if(j.entitlement)setRrEntState(j.entitlement);}
   }catch{
     setRrErr("We couldn't reach the server — give it a moment and try again.");
     track("record_review_failed",{plan:tier});
   }finally{setRrBusy(false);}
 };
 const downloadRecordReview=()=>{
   if(!rrReport)return;
   track("record_review_downloaded",{plan:tier});
   const blob=new Blob([rrReport.html],{type:"text/html"});
   const url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download="Record-Review.html";document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),4000);
 };
 // digest_locked_shown (optional §3.7): fires once per page when the free-tier
 // teaser renders — lets the owner measure teaser→pricing lift.
 const teaserFired=useRef(false);
 useEffect(()=>{if(tier==="free"&&momentum&&momentum.weekCount>0&&!teaserFired.current){teaserFired.current=true;track("digest_locked_shown",{plan:tier})}},[tier,momentum]);
 // 24-hour free trial: dashboard fallback auto-start. If a trial-intent marker
 // survived to here (capture completed through a path that never hit /confirm's
 // done state), start the trial now — idempotent + quiet, one per person ever.
 useEffect(()=>{ void maybeStartTrial(); },[]);
 // "The Organizer" promo (100% since 2026-08-12 D3 — every free dad gets the
 // live trial panel from the Document Organizer card; paid/suite tiers see the
 // real Organizer). organizer_promo_shown fires when the eligible card is on
 // screen (i.e. this dashboard mount).
 const promoEligible=tier==="free"&&!suiteUnlocked;
 const orgTrialRemaining = tier==="free" && typeof user?.organizerTrial?.remaining === "number" ? Math.max(0, user.organizerTrial.remaining) : 5;
 useEffect(()=>{if(promoEligible)track("organizer_promo_shown",{})},[promoEligible]);
 // App-shell tab mapping (app-redesign-spec §2.2): the Organizer is an internal
 // deep-link tab — Tools stays highlighted in the bar while it is open.
 const navTab: TabKey = tab === "organizer" || tab === "case" || tab === "action" ? "tools" : (tab as TabKey);
 // The Organizer featured hero card states (spec §3): free & has trials left →
 // "Try it free"; 5 used → "Demo used — part of Command Center"; else → "Coming soon".
 const organizerLive = promoEligible && orgTrialRemaining > 0;
 const organizerPill = suiteUnlocked ? "Live — in your plan" : organizerLive ? "Try it free" : (promoEligible && orgTrialRemaining === 0) ? "Demo used — part of Command Center" : "Part of Command Center";
 const openOrganizer = () => { track("organizer_open", { plan: tier }); if (organizerLive) track("organizer_promo_clicked", {}); setTab("organizer"); document.getElementById("main")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); };
 const openCaseSummary = () => { setTab("case"); document.getElementById("main")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); };
 const openActionCenter = () => { setTab("action"); document.getElementById("main")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); };
 // Loading gate (A1×B1): while the session check is pending, never render the
 // logged-out-looking dashboard ("Good to see you, there." / Plan: Free) — a
 // minimal calm loading state instead. On a confirmed 5xx/network outage after
 // the retry, a calm in-page error with Retry (no redirect, no logged-out shell).
 if(authState==="checking")return <div className="flex min-h-dvh items-center justify-center px-5"><div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-forest/20 border-t-forest" aria-hidden="true"/><p className="mt-4 text-base text-stone">Loading your Command Center…</p></div></div>;
 if(authState==="error")return <div className="flex min-h-dvh items-center justify-center px-5"><div className="card w-full max-w-md p-7 text-center"><h1 className="font-display text-2xl font-semibold leading-snug text-forest">We couldn't reach the server — give it a moment.</h1><button type="button" onClick={()=>{setAuthRetry(n=>n+1);setAuthState("checking")}} className="btn-primary mt-6 w-full">Retry</button><a href="/" className="btn-ghost mt-3 w-full">Back to home</a></div></div>;
 return <div className="min-h-dvh pb-24"><header className="sticky top-0 z-20 min-h-16 border-b border-line/70 bg-cream"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-2"><a href="/" aria-label="Before You Send home" className="-m-1 flex min-h-11 shrink-0 items-center rounded-lg p-1"><img src="/logo-bys.svg" alt="" aria-hidden="true" className="h-7 w-7" /></a><UserMenu user={user} tier={tier} context="dashboard" /></div></header>
<main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-8 sm:py-12"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="font-display text-3xl font-semibold leading-tight text-forest sm:text-4xl">Your calm command center</h1><p className="mt-2 max-w-xl text-lg text-stone">Start with the message in front of you.</p>{user?.trial?.active&&(function(){const h=trialHoursLeft(user?.trial?.expiresAt);return h===null?null:<span className="mt-3 inline-flex items-center gap-2 rounded-lg border border-forest/25 bg-forest/10 px-3 py-1.5 text-sm font-semibold text-forest"><span className="h-1.5 w-1.5 rounded-full bg-forest" aria-hidden="true"/>Trial active — {h}h left</span>})()}</div>{user?.isOwner&&<a href="/owner" className="btn-primary w-full shrink-0 sm:mt-1 sm:w-auto">Live metrics →</a>}</div>

 {tab==="log"?<CommunicationLog tier={tier} child={child} catchUp={catchUp} onCatchUpDone={()=>setCatchUp(null)} onReviewReply={(msg)=>{setDraft(msg);setStatus("idle");setBlocks([]);setLandingText("");setError("");setTab("ai")}}/>:tab==="timeline"?<EventTimeline tier={tier} organizerAccess={organizerReadable} onGoLog={()=>setTab("log")} onGoOrganizer={()=>setTab("organizer")} onReviewReply={(msg)=>{setDraft(msg);setStatus("idle");setBlocks([]);setLandingText("");setError("");setTab("ai")}}/>:tab==="sort"?<Suspense fallback={<section className="card mt-5 p-6 text-base text-stone">Opening Sort My Pile…</section>}><SortMyPile tier={tier} sortUntilActive={sortUntilActive} onBack={()=>setTab("organizer")} onOpenOrganizer={()=>setTab("organizer")}/></Suspense>:tab==="organizer"?organizerReadable?<Suspense fallback={<section className="card mt-5 p-6 text-base text-stone">Opening The Organizer…</section>}><Organizer tier={tier} children={children} profile={user?.profile} onProfilePatch={(p)=>setUser((u:any)=>({...u,profile:p}))} onGoTo={(t)=>setTab(t)} onChildSave={onChildSave} lapsed={organizerLapsed} onRemoved={removeChild} onLogGap={(gap:any)=>{setCatchUp(gap);setTab("log")}} rhDismissed={rhDismissed} onRhDismiss={(f:string)=>{setRhDismissed((prev:Record<string,boolean>)=>({...prev,[f]:true}))}}/></Suspense>:promoEligible?<Suspense fallback={<section className="card mt-5 p-6 text-base text-stone">Opening The Organizer…</section>}><OrganizerTrial trialRemaining={orgTrialRemaining}/></Suspense>:<OrganizerLocked tier={tier} onSortPile={()=>{track("sortpile_view",{plan:tier});setTab("sort")}}/>:tab==="case"?suiteUnlocked?<Suspense fallback={<section className="card mt-5 p-6 text-base text-stone">Opening Case Summary…</section>}><CaseSummary tier={tier} onGoTo={(t)=>{setTab(t)}}/></Suspense>:<CaseSummaryLocked tier={tier}/>:tab==="action"?suiteUnlocked?<Suspense fallback={<section className="card mt-5 p-6 text-base text-stone">Opening Action Center…</section>}><ActionCenter tier={tier} onGoTo={(t)=>{setTab(t)}}/></Suspense>:<ActionCenterLocked tier={tier}/>:tab==="tools"?<section id="tools" className="mt-5"><ToolsHub tier={tier} suiteUnlocked={suiteUnlocked} organizerLive={organizerLive} organizerPill={organizerPill} canExport={canExport} attorneyPrepUnlocked={attorneyPrepUnlocked} rrEnt={rrEnt} rrUsed={rrUsed} rrBusy={rrBusy} rrErr={rrErr} rrReport={rrReport} rrEntState={rrEntState} exportBusy={exportBusy} packBusy={packBusy} packMsg={packMsg} onOpenOrganizer={openOrganizer} onOpenCaseSummary={openCaseSummary} onOpenActionCenter={openActionCenter} onExport={exportRecord} onGeneratePack={generatePack} onRunRecordReview={runRecordReview} onDownloadRecordReview={downloadRecordReview} /><div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>setTab("log")} className="chip"><IconLog className="h-5 w-5"/>Log →</button><button onClick={()=>setTab("timeline")} className="chip"><IconTimeline className="h-5 w-5"/>Timeline →</button></div><div className="mt-10 border-t border-line pt-8"><h2 className="font-display text-xl font-semibold text-forest">Account</h2><p className="mt-1 max-w-xl text-base text-stone">Delete your account and everything in it — saved reviews, log, and timeline.</p><button onClick={deleteAccount} className="mt-4 min-h-11 rounded-[10px] border border-red-900/30 bg-card px-5 text-base font-semibold text-red-900">Delete my account</button>{user?.profile?.giftUntil&&new Date(user.profile.giftUntil).getTime()>Date.now()&&<p className="mt-4 text-base text-stone">Gifted month active through {new Date(user.profile.giftUntil).toLocaleDateString()}.</p>}{user&&user.hasPassword===false&&<div className="mt-6"><h3 className="text-lg font-semibold text-forest">Set a password</h3><p className="mt-1 text-base text-stone">Optional — lets you sign back in anytime from any browser.</p>{pwDone?<p className="mt-2 text-base text-forest" role="status">Password set — you can sign in anytime.</p>:pwOpen?<div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"><label htmlFor="account-password" className="sr-only">Password</label><input id="account-password" type="password" minLength={8} value={pw} onChange={e=>{setPw(e.target.value);setPwMsg("")}} placeholder="At least 8 characters" className="input"/><button onClick={setDashboardPassword} disabled={pwBusy} className="btn-primary shrink-0">{pwBusy?"Saving…":"Set password"}</button><button onClick={()=>setPwOpen(false)} className="btn-ghost shrink-0 text-stone">Cancel</button></div>:<button onClick={()=>setPwOpen(true)} className="mt-3 min-h-11 rounded-[10px] border border-line bg-card px-5 text-base font-semibold text-forest">Set a password →</button>}{pwMsg&&!pwDone&&<p role="alert" className="mt-2 text-base text-red-800">{pwMsg}</p>}</div>}</div></section>:tab==="ai"?<section className="mt-5 space-y-5"><ModeSwitch mode={tool} onChange={switchTool}/>{user?.quota&&(tier==="free"&&user.quota.remaining===0?<div className="rounded-xl border border-forest/20 bg-cream-deep/60 px-4 py-4"><p className="text-lg font-semibold text-forest">No big deal — here's how to keep going.</p><p className="mt-1 text-base leading-relaxed text-stone">Your 5 free uses are done for this month — reviews and analyses together. They're back on the 1st, and your draft is still here.</p>{user.quota.credits>0&&<p className="mt-2 text-base font-semibold text-forest">{user.quota.credits} review credit{user.quota.credits===1?"":"s"} left</p>}<div className="mt-3 flex flex-wrap gap-2"><a href="/pricing" onClick={()=>{track("quota_cta_click",{});recordSurface("quota_cta")}} className="btn-primary min-h-11 px-5 text-base">Steady — 30 reviews a month, $4.99</a><button onClick={buyTopUp} className="btn-ghost min-h-11 px-5 text-base text-forest">10 more reviews now — $9.50</button></div><p className="mt-3 text-sm text-stone">Cancel anytime.</p></div>:null)}{tier!=="free"&&digest&&digest.week?.reviewed>0&&<div><DigestCard digest={digest} tier={tier} onGoLog={()=>setTab("log")}/></div>}{tier==="free"&&momentum&&momentum.weekCount>0&&<div><Momentum weekCount={momentum.weekCount} recent={momentum.recent}/><p className="mt-3 text-sm text-stone">Your weekly digest is part of Steady — <a href="/pricing" className="font-semibold text-forest underline underline-offset-4">$4.99/mo →</a></p></div>}<TomorrowDraftsList onLoad={(t)=>{setDraft(t);document.getElementById("home-draft")?.scrollIntoView({behavior:scrollBehavior(),block:"center"});}}/><div className="card overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><label htmlFor="home-draft" key={tool} className="bys-mode-settle block text-lg font-semibold text-ink">{tool==="analyze"?"Describe what happened":"Paste the message you're about to send"}</label><p className="mt-1 text-sm text-stone">{tool==="analyze"?"What they said, what you did, where it left things.":"Your draft stays private to you."}</p></div><div className="px-5 py-4 sm:px-6"><textarea id="home-draft" value={draft} onChange={e=>{setDraft(e.target.value);onTyping()}} onFocus={onTyping} onBlur={clearTyping} rows={6} maxLength={5000} placeholder={tool==="analyze"?"Tell it like it happened — no need to be perfect.":"Start typing or paste your message…"} className="min-h-44 w-full resize-y rounded-xl border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"/>{attachments.length>0&&<AttachChips mode={tool} attachments={attachments} onRemove={(name)=>setAttachments(prev=>prev.filter(a=>a.name!==name))}/>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3">{tool==="analyze"?(draft.trim().length<=120?<div className="flex flex-wrap gap-2" role="group" aria-label="What happened">{PROMPT_CHIPS.map(c=><button key={c.label} type="button" onClick={()=>appendChip(c.prefix)} className="chip min-h-11 px-3.5 py-2 text-sm">{c.label}</button>)}</div>:null):<button type="button" onClick={()=>setDraft("Can we agree on a pickup time for Friday? I want to make sure the kids know the plan.")} className="chip min-h-11 px-3.5 py-2 text-sm">Try an example</button>}<div className="ml-auto flex items-center gap-2"><span className="text-base text-taupe tabular-nums">{draft.length}/5000</span><AttachControl mode={tool} canAttach={canAttach} signedOut={false} attachments={attachments} onChange={setAttachments} disabled={status==="streaming"}/></div></div><button onClick={tool==="analyze"?analyze:review} disabled={!draft.trim()||status==="streaming"} className="btn-primary mt-4 w-full"><span key={tool} className="bys-mode-settle">{status==="streaming"?(tool==="analyze"?"Analyzing…":"Reviewing…"):(tool==="analyze"?"Analyze this situation":"Review My Message")}</span></button></div></div>{error&&<div role="alert" className="rounded-xl border border-red-900/15 bg-card p-5 shadow-card"><p className="text-base leading-relaxed text-red-900">{error}</p><button type="button" onClick={tool==="analyze"?analyze:review} className="btn-primary mt-4 min-h-11 w-full sm:w-auto">Try again</button><p className="mt-3 text-sm text-stone">This try didn't use a review — your draft is still here.</p></div>}{show&&status!=="error"&&<div aria-live="polite">{landingText?<div className="card mt-5 p-5"><p className="text-lg font-semibold tracking-tight text-forest">Your saved review</p><p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">{landingText}</p></div>:<ReviewResults blocks={blocks} mode={mode} draft={draft} streaming={status==="streaming"} hideCapture tool={tool}/>}{status==="done"&&!landingText&&blocks.length>0&&mode!=="demo"&&didYouSendFresh&&tool==="review"&&<div className="mt-4"><DidYouSendIt key={calmKey} draft={reviewedDraftRef.current||draft} blocks={blocks} eventId={calm.eventId} score={score} tier={tier as "free"|"steady"|"command"|"ultimate"} onGoLog={()=>setTab("log")}/></div>}{status==="done"&&!landingText&&<div className="rounded-xl border border-forest/20 bg-forest p-5 text-cream"><p className="text-lg font-semibold">{tool==="analyze"?"Ready to keep this analysis?":"Ready to keep this one?"}</p><p className="mt-1 text-base text-cream/80">{tool==="analyze"?"Save the situation and its analysis to your private history.":"Save the draft and its full review to your private history."}</p>{justSaved?<div className="mt-4"><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold">Saved.</p><p className="mt-1 text-base text-cream/85">{tool==="analyze"?"Your analysis is on your record — it's yours to keep.":"This review is on your record — it's yours to keep."}</p></div><button type="button" onClick={()=>setJustSaved(false)} className="icon-btn min-h-11 text-cream/80 hover:bg-forest-soft" aria-label="Dismiss"><IconClose className="h-5 w-5"/></button></div><a href="/pricing" className="mt-2 inline-flex items-center text-base font-semibold text-cream underline underline-offset-4">Want every review kept forever? Steady — $4.99/mo →</a></div>:<button onClick={save} className="btn-primary mt-4 bg-cream text-forest hover:bg-cream-deep">{tool==="analyze"?"Save this analysis":"Save this review"}</button>}{notice&&<p className="mt-3 text-base">{notice}</p>}</div>}</div>}</section>:<section className="mt-5"><div className="flex items-baseline justify-between gap-3"><h2 className="font-display text-2xl font-semibold text-forest">Saved reviews</h2><span className="text-base text-stone">{saved.length} saved</span></div>{saved.length===0?<p className="card mt-4 p-5 text-base text-stone">Your saved reviews and analyses will appear here.</p>:<div className="card mt-4 divide-y divide-line overflow-hidden">{saved.map(r=><div key={r.id}><button onClick={()=>open(r)} className="block w-full px-5 py-4 text-left transition hover:bg-cream-deep/40"><span className="flex items-center justify-between gap-3"><span className="min-w-0 line-clamp-1 font-medium text-ink">{r.title||r.draft?.slice(0,90)}{!r.title&&r.draft?.length>90?"…":""}</span><span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-cream-deep px-2 py-0.5 text-xs font-medium text-taupe">{r.kind==="analysis"?"Situation":"Message"}</span></span><span className="mt-0.5 block text-sm text-taupe">{new Date(r.createdAt).toLocaleDateString()}</span></button><div className="flex items-center gap-4 px-5 pb-3.5">{renameId===r.id?(<><input value={renameDraft} onChange={(e)=>{setRenameDraft(e.target.value);setNotice("");}} placeholder="A short name to find it by…" maxLength={120} className="input min-h-11 max-w-xs rounded-xl px-4 py-2"/><button onClick={()=>renameReview(r.id)} disabled={renameBusy} className="btn-primary min-h-11 px-4 text-base">{renameBusy?"Saving…":"Save name"}</button><button onClick={()=>setRenameId(null)} className="btn-ghost min-h-11 px-4 text-base text-stone">Cancel</button></>):(<><button onClick={()=>{setRenameId(r.id);setRenameDraft(r.title||r.draft?.slice(0,40)||"");track("review_rename",{});}} className="min-h-11 text-base text-forest underline underline-offset-4">✎ Rename</button><button onClick={()=>remove(r.id)} className="min-h-11 text-base text-stone underline">Delete</button></>)}</div></div>)}</div>}</section>}
 {notice&&<p className="mt-5 rounded-2xl bg-cream-deep px-4 py-3 text-base text-stone" role="status">{notice}</p>}</main><TabBar active={navTab} onChange={setTab} savedCount={saved.length}/>{payOutcome&&<PaymentSurface outcome={payOutcome} onClose={()=>setPayOutcome(null)} onError={(m)=>setNotice(m||"Checkout is not available right now.")}/>}</div>
}