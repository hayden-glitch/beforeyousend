// Recovered from the last known-good Vercel build. Do not edit route behavior without tests.
// @ts-nocheck
import Stripe from "stripe";
import * as crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { readUsers, writeUsers, readReviews, writeReviews, pruneReviews, deleteUserData, readLog, writeLog, readTimeline, writeTimeline, addSignup, signupReviews, reviewsThisMonth, incrementAnonReview, incrementAnonReviewVid, refundAnonReview, userReviewUsage, anonReviewVidUsed, incrementUserReview, refundUserReview, upsertSessionFromPageView, getSessionAttribution, paidEventRecent, addEvent, metricsSummary, eventsForVid, upsertAuthSession, getAuthSession, deleteAuthSession, purgeExpiredAuthSessions, upsertConfirmToken, getConfirmToken, deleteConfirmToken, purgeExpiredConfirmTokens, confirmRateHit, organizerTrialCount, markOrganizerTrial, incrementOrganizerTrialIp, readOrganizerFiles, readOrganizerFilesMeta, addOrganizerFile, deleteOrganizerFile, deleteReview, updateOrganizerFile, organizerClassifyCountToday, incrementOrganizerClassify, deleteSignups, purgeOldSignups, readReviewsForUser, readLogForUser, readTimelineForUser, readCaseSummary, writeCaseSummary, readActionCenter, writeActionCenter, addSessionPlay, sessionPlayForVisitor, upsertTikTokToken, readTikTokToken, addTikTokPublish, readTikTokPublishes, insertReviewEvent, updateReviewEventSent, reviewEventsRecent, reviewEventsWeekCount, reviewEventsCountToday, findRecentReviewedLog, insertGiftCode, getGiftCode, getGiftCodeBySession, redeemGiftCode, giftCodesForGiver, reviewEventsDigest, updateUserProfile, insertConsultation, insertAttorneyPack, insertRecordReview, attorneyPacksForUser, recordReviewsForUser, saveRecordReviewReport, latestRecordReviewReport, deleteRecordReviewBySession, getTrial, startTrial, clearMetrics, customerMetrics } from "./storage";
import { computeImpactScore } from "./impactScore";
import { buildRecordReview } from "./recordReview";
import { TAXONOMY, folderBySlug } from "./taxonomy";
// Shared rule classifier (landing "Sort one thing free" demo + Organizer
// fallback + Sort My Pile rule path) — single source of truth, see ruleClassify.ts.
import { ruleFolderFor, fallbackOrganizerClassify, RECORD_HEALTH_MISSING_RULES } from "./ruleClassify";
import { expDate, expEsc, buildExportSectionsHtml, exportPackCss } from "./exportPack";
import { buildAttorneyPack } from "./attorneyPack";


var TIER_LIMITS = { free: 5, steady: 30, command: Infinity, ultimate: Infinity };
function userTier(user) {
  const t = user?.profile?.tier;
  if (t === "steady" || t === "command" || t === "ultimate") {
    // Subscription expiry (audit 25ffae58 H2): a subscription cancelled in the
    // Stripe portal stays paid through its period end (tierRenewsAt), then the
    // account is base tier again. tierRenewsAt missing = no expiry known (legacy
    // or seeded accounts) — keep the paid tier. Historical paid markers stay on
    // the profile; only the EFFECTIVE tier downgrades here.
    const renewsAt = user?.profile?.tierRenewsAt;
    if (renewsAt && new Date(renewsAt).getTime() <= Date.now()) {
      // fall through to the gift/bank checks below
    } else {
      return t;
    }
  }
  // Gift-a-month (calm-loop slice 2): a banked gift lifts free->steady (30
  // reviews/mo + digest unlock). Paid users keep their higher tier; a gift
  // banked under a paid account stays banked (covers them if they ever drop).
  const giftUntil = user?.profile?.giftUntil;
  if (giftUntil && new Date(giftUntil).getTime() > Date.now()) return "steady";
  // 24-hour free trial (owner 2026-08-13): while profile.trialUntil is in the
  // future the account gets the FULL paid experience — treated as the top
  // tier for every gate (review limits, attachments, history, Organizer, Case
  // Summary, Action Center, export, digest). Expiry is pure timestamp math:
  // the moment trialUntil passes, the account is base tier again. The mirror
  // onto profile.trialUntil is written at grant time and re-synced from the
  // bys_trials row in authMe, so this synchronous gate never needs a DB read.
  const trialUntil = user?.profile?.trialUntil;
  if (trialUntil && new Date(trialUntil).getTime() > Date.now()) return "ultimate";
  return "free";
}
function reviewLimitFor(user) {
  return TIER_LIMITS[userTier(user)];
}
// Sort My Pile (one-time pack, 2026-08-11): a buyer gets 30 days of the live
// Organizer via profile.sortUntil — same mechanics as giftUntil (which lifts
// free->steady), different entitlement. sortPileActive() is the single check;
// organizerEnabled() gates the Organizer endpoints (files CRUD + sort).
function sortPileActive(user) {
  const until = user?.profile?.sortUntil;
  return !!until && new Date(until).getTime() > Date.now();
}
function organizerEnabled(user) {
  const t = userTier(user);
  return t === "command" || t === "ultimate" || sortPileActive(user);
}
// Attorney Prep Pack (one-time, 2026-08-12): entitlement = Ultimate tier OR a
// durable paid grant. The grant is stamped on profile.attorneyPrep at verified
// paid confirm (sync fast-path for pricing/UI); the canonical durable row is
// bys_attorney_packs, written in the same confirm (session_id UNIQUE, mirrors
// bys_consultations). Re-download stays possible — the grant IS the entitlement;
// pack generation/download is a later build. Server gates must never trust the
// client: check this helper (and the durable row where the stamp is missing).
function attorneyPrepEntitled(user) {
  if (userTier(user) === "ultimate") return true;
  return user?.profile?.attorneyPrep === true;
}
// Record Review (one-time $29.50, 2026-08-13, Stage 1 money path): entitlement =
// (a) a durable purchased grant (kind='purchase' row — permanent) OR (b) Ultimate
// tier with an unused annual allowance (no redemption row in the rolling 365-day
// window — Ultimate gets 1 per year). Every confirm/redeem writes a durable row
// (bys_record_reviews, session_id UNIQUE, kind purchase|redemption) so the
// 1/year window is enforced server-side by created_at. Read failure degrades to
// not-entitled (Buy button) — the pricing card never shows a false unlock.
// Shape: { entitled, kind: 'ultimate'|'purchased'|'none', nextAvailableAt? }.
async function recordReviewEntitlement(user) {
  if (user?.profile?.recordReview === true) return { entitled: true, kind: "purchased" };
  let rows = [];
  try {
    rows = await recordReviewsForUser(user.id);
  } catch (err) {
    console.warn("[record-review] entitlement read failed:", err);
  }
  if (rows.some((r) => r.kind === "purchase")) return { entitled: true, kind: "purchased" };
  if (userTier(user) === "ultimate") {
    const DAY = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - 365 * DAY;
    const inWindow = rows.map((r) => new Date(r.createdAt).getTime()).filter((t) => t > cutoff).sort((a, b) => a - b);
    if (inWindow.length === 0) return { entitled: true, kind: "ultimate" };
    return { entitled: false, kind: "none", nextAvailableAt: new Date(inWindow[0] + 365 * DAY).toISOString() };
  }
  return { entitled: false, kind: "none" };
}
// Gift-code alphabet: 32 chars (no I/L/O/0/1) -> 8 chars ~ 1.1e12 combos.
// Single-use + auth'd redeem makes brute force infeasible.
var GIFT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeGiftCode() {
  var out = "BYS-";
  for (var i = 0; i < 8; i++) {
    if (i === 4) out += "-";
    out += GIFT_ALPHABET[Math.floor(Math.random() * GIFT_ALPHABET.length)];
  }
  return out;
}
function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd)
    return fwd.split(",")[0].trim().slice(0, 64) || "unknown";
  return (req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}
// bys_vid cookie value (mirrors the regex used in handleApiRequest); null when
// the visitor has no cookie yet (first hit, cookies disabled, direct API call).
function visitorVid(req) {
  const m = req.headers.get("cookie")?.match(/(?:^|;\s*)bys_vid=([^;]+)/);
  return m ? m[1].slice(0, 100) : null;
}
// IP-wide safety net for anonymous reviews: a single shared IP (carrier CGNAT /
// office Wi-Fi) may only produce this many anonymous reviews per UTC day. The
// real per-user quota is the vid cookie (1/day) — this cap only bounds abuse
// (cookie clearing / rewriting), never a genuine first-touch dad on a busy IP.
const ANON_IP_DAILY_CAP = Number(process.env.ANON_IP_DAILY_CAP || 25);
// Per-instance concurrency guard: bounds simultaneous review streams on a single
// serverless instance so an ad burst can't stack unbounded LLM connections.
// Instance-local only — it softens Vercel concurrent-invocation limits, it does
// not replace them (that's a platform decision flagged to the owner).
let inFlightReviews = 0;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_REVIEWS || 8);
// Same per-instance guard for organizer classification: a burst of trial/paid
// uploads must not stack unbounded SambaNova calls — saturated instances fall
// back to the deterministic rule classifier (calm, no crash).
let inFlightOrganizerClassify = 0;
const MAX_ORGANIZER_CLASSIFY = Number(process.env.MAX_ORGANIZER_CLASSIFY || 4);
function resolveLLM() {
  const key = process.env.SAMBANOVA_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!key)
    return null;
  const isSamba = !!process.env.SAMBANOVA_API_KEY;
  const base2 = (process.env.LLM_BASE_URL || (isSamba ? "https://api.sambanova.ai/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || (isSamba ? "Llama-4-Maverick-17B-128E-Instruct" : "gpt-4o-mini");
  return { key, base: base2, model };
}
var llm = resolveLLM();
// Restored runtime production detection (Codex a96c03f): hardcoding `false`
// here silently enabled the DEV-only sample fallback for REAL drafts in
// production whenever a provider key was missing. Mirror serve.ts's isProd —
// production never serves the deterministic sample to a real draft.
var isProd2 = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
var fallbackAllowed = !isProd2 && process.env.ALLOW_DEV_FALLBACK !== "0";
if (!llm && fallbackAllowed) {
  console.warn("[review] No LLM key configured (SAMBANOVA_API_KEY / OPENAI_API_KEY / LLM_API_KEY) — using the DEV-ONLY sample fallback. Set a key to serve live reviews.");
} else if (!llm) {
  console.warn("[review] No LLM key configured and NODE_ENV=production — /api/review will return an error until a key is set.");
}
var cache = new Map;
function sleep(ms2) {
  return new Promise((r) => setTimeout(r, ms2));
}
var CACHE_TTL_MS = 10 * 60 * 1000;
var CACHE_MAX = 100;
function cacheKey(draft) {
  let h = 0;
  for (const c of draft.trim().toLowerCase())
    h = (h << 5) - h + c.charCodeAt(0) | 0;
  return Math.abs(h).toString(36);
}
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit)
    return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.lines;
}
function cacheSet(key, lines) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined)
      cache.delete(oldest);
  }
  cache.set(key, { lines, exp: Date.now() + CACHE_TTL_MS });
}
var SYSTEM_PROMPT = `You are "Before You Send", a calm, practical communication coach for separated or divorced fathers in high-conflict co-parenting situations. A father has pasted a draft message he plans to send to his co-parent. Review it honestly and helpfully: show how it may be received, name the conflict risks, flag specific problematic language, preserve the facts that matter, and give three brief rewrites. You are NOT a lawyer and give NO legal advice. Never predict legal outcomes and never tell him what a judge or attorney will think.

Respond in EXACTLY this format, nothing before or after:

### HOW IT MAY BE RECEIVED
(a short, specific, realistic read on how the recipient will likely interpret the message: tone, subtext, what it may trigger. 1-3 sentences.)

### CONFLICT & ESCALATION RISKS
(2-4 short bullets. Name the specific risk and why: threats of court, ultimatums, personal attacks, blame, absolutes, re-litigating old fights, putting children in the middle.)

### WATCH OUT FOR
(2-5 short bullets. Quote the exact problematic phrase in "quotes", then name the pattern: emotional, accusatory, vague, threatening, defensive, unnecessary, absolutist, or manipulative. Be precise.)

### FACTS WORTH PRESERVING
(1-4 short bullets. The concrete, factual, useful information in the draft that should be kept: dates, logistics, specific requests. Do NOT invent facts that are not in the draft.)

### REWRITE: GENTLE
(1-3 sentences. Warm but not weak, cooperative, child-focused.)

### REWRITE: DIRECT
(1-3 sentences. Concise and matter-of-fact. States the request clearly. No apology spirals.)

### REWRITE: FIRM BUT NEUTRAL
(1-3 sentences. Sets a boundary or expectation firmly, without hostility or threats. Neutral, professional tone.)

Rules: every rewrite must be brief (under 40 words), plain English, specific to the real content of the draft, and never legalistic. Reframe courtroom threats as practical requests. Keep the children's wellbeing central. Never mention attorneys as advice, never claim to know what a court will do, never give legal advice. If the draft is already good, say so briefly in HOW IT MAY BE RECEIVED and keep the rewrites close to the original.

Draft to review:
`;
var SECTION_MAP = [
  { re: /HOW IT MAY BE RECEIVED/i, id: "received", kind: "section" },
  { re: /CONFLICT.*ESCALATION RISKS/i, id: "risks", kind: "section" },
  { re: /WATCH OUT FOR/i, id: "watchout", kind: "section" },
  { re: /FACTS WORTH PRESERVING/i, id: "facts", kind: "section" },
  { re: /REWRITE:?\s*GENTLE/i, id: "gentle", kind: "rewrite" },
  { re: /REWRITE:?\s*DIRECT/i, id: "direct", kind: "rewrite" },
  { re: /REWRITE:?\s*FIRM/i, id: "firm", kind: "rewrite" }
];
var SECTION_TITLES2 = {
  received: "How it may be received",
  risks: "Conflict & escalation risks",
  watchout: "Watch out for",
  facts: "Facts worth preserving",
  gentle: "Gentle",
  direct: "Direct",
  firm: "Firm but Neutral"
};

// ---- Two-mode AI Co-Parent: Situation Analyzer (owner 2026-08-11) ----
// Stream order (spec §2.2): the payoff FIRST — a calm reply to consider — then
// four analysis sections. Section ids: reply (rewrite block), seen, driving,
// next, document. Same NDJSON envelope as the review; the reply reuses the
// rewrite/rwtext block kinds so the client needs zero new plumbing.
var ANALYZE_SYSTEM_PROMPT = `You are "Before You Send", a calm, practical coach for separated or divorced fathers in high-conflict co-parenting situations. A father has described a situation or an exchange with his co-parent — not necessarily a message he plans to send. Analyze it calmly and helpfully: give ONE short suggested reply he could send if he wants to respond, show how the situation may be seen, what's likely driving the co-parent, what to do next, and what to document. You are NOT a lawyer and give NO legal advice. Never predict legal outcomes and never tell him what a judge or attorney will think.

Respond in EXACTLY this format, nothing before or after. Sections in THIS ORDER:

### A CALM REPLY TO CONSIDER
(ONE short suggested reply, under 40 words, plain English, child-focused. Mark it "A starting point — not a script." If no reply is appropriate right now, give a one-line holding reply and add the line "No reply needed right now — here's why." followed by one short sentence.)

### HOW THIS MAY BE SEEN
(1-3 sentences. A fair read of the situation from the co-parent's side, and how a third party might later see it. No outcome predictions.)

### WHAT'S LIKELY DRIVING THEM
(2-4 short bullets. Possible reasons for the co-parent's behavior, each phrased with "may" or "might". Never a diagnosis, never certainty.)

### WHAT TO DO NEXT
(2-4 short bullets. Concrete, doable, child-focused steps, one sentence each, in order. No legal advice.)

### WHAT TO DOCUMENT
(2-4 short bullets. Factual record items: date, time, who was present, what was said or refused. Only facts from the situation described — never invent.)

Rules: stay calm and specific to the real situation. Never mention attorneys as advice, never claim to know what a court will do, never give legal advice. If the description is thin or vague, add ONE short line in HOW THIS MAY BE SEEN about what would sharpen it, and keep the rest brief.

Situation:
`;
var ANALYZE_SECTION_MAP = [
  { re: /A CALM REPLY TO CONSIDER/i, id: "reply", kind: "rewrite" },
  { re: /HOW THIS MAY BE SEEN/i, id: "seen", kind: "section" },
  { re: /WHAT.?S LIKELY DRIVING THEM/i, id: "driving", kind: "section" },
  { re: /WHAT TO DO NEXT/i, id: "next", kind: "section" },
  { re: /WHAT TO DOCUMENT/i, id: "document", kind: "section" }
];
var ANALYZE_SECTION_TITLES = {
  reply: "A calm reply to consider",
  seen: "How this may be seen",
  driving: "What's likely driving them",
  next: "What to do next",
  document: "What to document"
};
// Dev-only fallback (mirrors fallbackEvents): streams a canned analysis so the
// local harness is fully testable without a live AI key. Marked sample copy.
function analyzeFallbackEvents(situation) {
  const opening = situation.trim().slice(0, 90);
  const quote = opening ? `"${opening}…"` : "the situation described";
  const lines = [
    `### A CALM REPLY TO CONSIDER`,
    `I want to sort this out for the kids. Can we talk about it when we're both calm?`,
    ``,
    `### HOW THIS MAY BE SEEN`,
    `From the outside, ${quote} may read as two parents at odds — fair or not, that is how a third party could see it. If the description is thin, a line about what actually happened, in order, would sharpen the read.`,
    ``,
    `### WHAT'S LIKELY DRIVING THEM`,
    `- They may be reacting to feeling blamed or cornered, rather than the facts.`,
    `- They may be worried about losing control of the schedule.`,
    `- They may be carrying stress from something unrelated to the kids.`,
    ``,
    `### WHAT TO DO NEXT`,
    `- Keep your next move small: one question, one request, no lecture.`,
    `- Put the kids first in the words you choose — say what you want for them, not what's wrong with their parent.`,
    `- Give it a beat before you reply; a calm pause is a legitimate move.`,
    ``,
    `### WHAT TO DOCUMENT`,
    `- The date and time of the exchange, and who was present.`,
    `- What was said and what was refused, in plain words.`,
    `- What you did next, and whether the kids were involved.`
  ];
  const out = [];
  const state = { section: null, rewrite: null };
  for (const l of lines)
    out.push(...modelLineToEvents(l, state, ANALYZE_SECTION_MAP, ANALYZE_SECTION_TITLES));
  return out;
}
function cleanLine(raw) {
  let line = raw.trim();
  let bullet = false;
  if (/^[-*•]\s+/.test(line)) {
    bullet = true;
    line = line.replace(/^[-*•]\s+/, "");
  }
  line = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\*/g, "").trim();
  return { text: line, bullet };
}
function modelLineToEvents(raw, state, sectionMap, titles) {
  const trimmed = raw.trim();
  if (!trimmed)
    return [];
  // Two-mode AI Co-Parent (2026-08-11): the analyze stream passes its own
  // section map + title map (reply/seen/driving/next/document); review keeps
  // the module defaults. A null/undefined map means "review" — byte-identical.
  const map = sectionMap || SECTION_MAP;
  const titleMap = titles || SECTION_TITLES2;
  const header = map.find((s) => s.re.test(trimmed.replace(/^#+\s*/, "")));
  if (header) {
    if (header.kind === "section") {
      state.section = header.id;
      state.rewrite = null;
      return [
        JSON.stringify({
          type: "section",
          id: header.id,
          title: titleMap[header.id]
        })
      ];
    }
    state.rewrite = header.id;
    state.section = null;
    return [
      JSON.stringify({ type: "rewrite", id: header.id, title: titleMap[header.id] })
    ];
  }
  const { text, bullet } = cleanLine(trimmed);
  if (!text)
    return [];
  if (state.rewrite) {
    return [JSON.stringify({ type: "rwtext", id: state.rewrite, text })];
  }
  if (state.section) {
    return [
      JSON.stringify({ type: bullet ? "item" : "para", id: state.section, text })
    ];
  }
  return [JSON.stringify({ type: "para", id: "received", text })];
}
function fallbackEvents(draft) {
  const opening = draft.trim().slice(0, 90);
  const quote = opening ? `"${opening}…"` : "the opening line";
  const lines = [
    `### HOW IT MAY BE RECEIVED`,
    `It starts with frustration, and ${quote} reads as an attack rather than a request. Your co-parent will likely go on the defensive before hearing anything else in the message.`,
    ``,
    `### CONFLICT & ESCALATION RISKS`,
    `- Threatening court or legal action can escalate the conflict and may look hostile if the messages ever surface.`,
    `- Words like "never" and "always" turn a specific issue into a sweeping accusation.`,
    `- Bringing the children into the argument risks putting them in the middle of the dispute.`,
    ``,
    `### WATCH OUT FOR`,
    `- "stop being so unreasonable" — accusatory`,
    `- "you never / you're always" — absolutist and vague`,
    `- "I'll have my attorney take you back to court" — threatening`,
    `- "everyone knows it" — vague and inflammatory`,
    ``,
    `### FACTS WORTH PRESERVING`,
    `- Your specific request about time with the kids (dates and times, if mentioned).`,
    `- Any prior arrangements or commitments that support your request.`,
    `- That you raised the issue without insults or threats.`,
    ``,
    `### REWRITE: GENTLE`,
    `Hi — I'd like to work out a schedule that gives me more time with the kids. Can we pick a day this week to talk about what works for both of us?`,
    ``,
    `### REWRITE: DIRECT`,
    `I'd like to agree on a regular schedule so I can see the kids consistently. Let me know a good time to discuss it.`,
    ``,
    `### REWRITE: FIRM BUT NEUTRAL`,
    `I'm available to discuss a consistent schedule for the kids. Please let me know a time this week that works for you — I'd like to settle this without further back-and-forth.`
  ];
  const out = [];
  const state = { section: null, rewrite: null };
  for (const l of lines)
    out.push(...modelLineToEvents(l, state));
  return out;
}
async function* streamLLMEvents(draft, outerSignal, prompt, sectionMap, titles) {
  // One automatic retry on the INITIAL fetch only: 429/5xx (rate limit /
  // provider blip) cancel the body, brief backoff, retry once. Other 4xx are
  // deterministic (bad key, bad request) — never retried. Each attempt gets a
  // fresh 45s deadline, merged with the client's abort signal so a disconnect
  // kills the provider connection instead of pinning it for the full timeout.
  // 45s sits safely under the hosting function's ~60s hard limit (P1
  // 2026-08-13): the abort fires first, the catch runs, the client receives the
  // calm error event, and nothing is claimed (lazy quota). A platform
  // hard-kill cuts the stream with NO error event and NO cleanup — observed
  // live 2026-08-13: client saw raw EOF at 60.1s on a slow provider evening,
  // and the signed-in monthly counter stayed claimed.
  let res = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = outerSignal ? AbortSignal.any([outerSignal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
    res = await fetch(`${llm.base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llm.key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: llm.model,
        stream: true,
        temperature: 0.4,
        max_tokens: 800,
        messages: [
          { role: "system", content: prompt || SYSTEM_PROMPT },
          { role: "user", content: draft }
        ]
      }),
      signal
    });
    if (res.ok || !res.body)
      break;
    if ((res.status === 429 || res.status >= 500) && attempt === 1) {
      try {
        res.body.cancel();
      } catch {}
      await sleep(1500);
      continue;
    }
    break;
  }
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.error?.message ? `: ${j.error.message}` : "";
    } catch {}
    throw new Error(`AI provider error (${res.status})${detail}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder;
  let buf = "";
  // Accumulator for MODEL TEXT, separate from the SSE frame buffer above. AI
  // providers split tokens/words arbitrarily across SSE deltas — a header like
  // "### CONFLICT & ESCALATION RISKS" can arrive as "### CONFL" + "ICT &
  // ESCALATION RISKS" in two deltas, and "FIRM BUT NEUTRAL" can end split
  // across a frame boundary. Parsing each delta fragment individually shreds
  // headers (SECTION_MAP never matches a half-word) and leaks raw markdown /
  // mid-word splits into body text. So: append content here, and only feed
  // COMPLETE lines (split on \n) to modelLineToEvents — same as the proven
  // fallbackEvents path, which hands over whole lines and renders clean.
  let lineBuf = "";
  const state = { section: null, rewrite: null };
  for (;; ) {
    const { done, value } = await reader.read();
    if (done)
      break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf(`
`)) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:"))
        continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]")
        continue;
      try {
        const j = JSON.parse(payload);
        const content = j.choices?.[0]?.delta?.content ?? "";
        if (!content)
          continue;
        lineBuf += content;
        let nl2;
        while ((nl2 = lineBuf.indexOf("\n")) >= 0) {
          const modelLine = lineBuf.slice(0, nl2);
          lineBuf = lineBuf.slice(nl2 + 1);
          const evs = modelLineToEvents(modelLine, state, sectionMap, titles);
          for (const ev of evs)
            yield ev;
        }
      } catch {}
    }
  }
  // End of stream: process any remaining model text that had no trailing
  // newline so the final line is never dropped.
  if (lineBuf) {
    const evs = modelLineToEvents(lineBuf, state, sectionMap, titles);
    for (const ev of evs)
      yield ev;
  }
}
// Build a Headers object from a plain record. Array values (e.g. multiple
// Set-Cookie headers) MUST be appended one-by-one — spreading an array into the
// Headers constructor record comma-joins it into a single malformed header
// (verified on Node 22: { "Set-Cookie": ["a","b"] } → one header "a,b").
function toHeaders(base, extraHeaders = {}) {
  const h = new Headers(base);
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) for (const item of v) h.append(k, String(item));
    else h.set(k, String(v));
  }
  return h;
}
function json3(res, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(res), {
    status,
    headers: toHeaders({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders)
  });
}
function streamResponse(stream2, extraHeaders = {}) {
  return new Response(stream2, {
    headers: toHeaders({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, extraHeaders)
  });
}

// ---- Attachments (Steady+, owner 2026-08-11) ----
// FILES ARE NAME + NOTE ONLY. The client reads only file.name (+ a type
// guard) and never reads file bytes, so the pixels never leave the device and
// the no-OCR + privacy lines are trivially true. Validation mirrors the
// client: <=4 files, names <=120 chars, notes <=500 chars. Attachments are
// injected into the LLM prompt as context and are NEVER persisted (no
// bys_reviews rows, no storage) — the review text is what the dad keeps; The
// Organizer is the keep-place.
const ATTACH_402 = "Attaching photos and documents is part of the Steady plan — $4.99/mo.";
function parseAttachments(body) {
  const raw = body.attachments;
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Attachments must be a list of files." };
  if (raw.length > 4) return { ok: false, error: "Up to 4 files per review." };
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") return { ok: false, error: "One of the attachments is missing its name." };
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!name || name.length > 120) return { ok: false, error: "One of the file names is too long — 120 characters max." };
    const description = typeof a.description === "string" ? a.description.trim().slice(0, 500) : "";
    out.push({ name, description });
  }
  return { ok: true, attachments: out };
}
function attachKeySuffix(attachments) {
  return attachments.length ? "|att=" + attachments.map((a) => a.name + ":" + a.description).join(";;") : "";
}
function attachmentContext(attachments) {
  if (!attachments || attachments.length === 0) return "";
  return "\n\n" + attachments.map(
    (a) => `The dad attached: ${a.name} — his note: ${a.description || "none"}. Treat the note as context; do not review the file itself.`
  ).join("\n");
}

async function handleReview(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Send a JSON body with a draft." }, 400);
  }
  const draft = typeof body.draft === "string" ? body.draft.trim() : "";
  if (!draft)
    return json3({ error: "Paste a message to review first." }, 400);
  if (draft.length > 5000)
    return json3({ error: "That message is over 5,000 characters — try a shorter draft." }, 400);
  const parsedAtt = parseAttachments(body);
  if (!parsedAtt.ok) return json3({ error: parsedAtt.error }, 400);
  const attachments = parsedAtt.attachments;
  // Concurrency guard: reject BEFORE any quota/DB work, so a 503 under a burst
  // never touches a quota counter or writes anything. The client shows this
  // message in the failure fallback (which offers saving the draft instead).
  if (inFlightReviews >= MAX_CONCURRENT) {
    return json3({ error: "We're getting a lot of requests right now — give it a minute and try again." }, 503);
  }
  // Example reviews (landing "Try a real example review" button) must never
  // consume the anonymous daily free review or a logged-in user's quota, and
  // must not be persisted — they stream like a normal review but count nothing.
  const example = body.example === true;
  const session = getSession(req);
  // Attachment gate (Steady+, owner 2026-08-11): the effective tier (userTier,
  // which covers gift-month recipients) must be steady/command/ultimate.
  // Rejected BEFORE any quota decrement so a free dad's monthly uses are never
  // burned by a refused attachment request (same auth path as the Organizer 402).
  if (attachments.length > 0) {
    if (!session) return json3({ error: ATTACH_402 }, 402);
    const au = (await readUsers()).find((x2) => x2.id === session.userId);
    if (!au) return json3({ error: "Account not found. Please sign in again." }, 404);
    const at = userTier(au);
    if (at !== "steady" && at !== "command" && at !== "ultimate") return json3({ error: ATTACH_402 }, 402);
  }
  // Quota bookkeeping: ip/vid are the anon counter keys (the IP counter is the
  // per-day abuse cap, incremented at request start; the vid counter is the
  // real free slot, claimed lazily on success). claimSignedIn is the
  // success-time claim for signed-in credits / monthly counters — nothing is
  // consumed until a stream genuinely succeeds (P1 2026-08-13: a failed or
  // killed attempt must never burn quota, matching the anon lazy pattern).
  const ip = clientIp(req);
  let vid = visitorVid(req);
  let claimSignedIn = null;
  // Server-issued vid cookie for cookie-less clients (see the anon branch below).
  let setVidCookie = null;
  if (session) {
    if (!example) {
      const users = await readUsers();
      const u = users.find((x2) => x2.id === session.userId);
      if (!u)
        return json3({ error: "Account not found. Please sign in again." }, 404);
      const credits = Number(u.profile?.credits || 0);
      if (credits > 0) {
        // Credits path: READ-ONLY gate here — the credit is claimed only after
        // a successful stream (lazy, like the anon slot), so a failed or
        // killed stream can never burn a paid credit. Re-reads the user row so
        // a concurrent write (top-up, tier change) isn't clobbered.
        claimSignedIn = () => readUsers().then((users2) => {
          const u2 = users2.find((x3) => x3.id === u.id);
          if (u2 && Number(u2.profile?.credits || 0) > 0) {
            u2.profile = { ...u2.profile || {}, credits: Number(u2.profile?.credits || 0) - 1 };
            return writeUsers(users2);
          }
        }).catch((err) => console.warn("[review] credit claim failed:", err));
      } else {
        const limit = reviewLimitFor(u);
        if (Number.isFinite(limit)) {
          // M2: the monthly gate counts STREAMS (per-user-month counter in
          // bys_user_review_usage), not saved-review rows. READ-ONLY pre-check
          // 402s before any work; the counter is incremented only AFTER a
          // successful stream, so a failed/killed attempt never consumes a slot
          // (P1 2026-08-13, mirrors the anon lazy claim).
          const used = await userReviewUsage(u.id);
          if (used >= limit) {
            const msg = u.profile?.tier === "steady" ? `You've used this month's ${limit} reviews. They renew on the 1st — or get more reviews anytime.` : "You've used this month's 5 free reviews. They renew on the 1st — or get more reviews anytime.";
            return json3({ error: msg }, 402);
          }
          claimSignedIn = () => incrementUserReview(u.id).catch((e2) => console.warn("[review] user-count claim failed:", e2));
        }
      }
    }
  } else {
    if (!example) {
      // Anonymous quota, hybrid keying: the bys_vid cookie is the real quota key
      // (1 anonymous review per vid per UTC day), so a first-time dad on a shared
      // CGNAT/office IP is never blocked by a stranger's usage on that IP. The IP
      // counter becomes a per-day abuse cap (ANON_IP_DAILY_CAP) that only bites
      // above N anon reviews from the same IP (cookie clearing/rewriting).
      if (!vid) {
        // Cookie-less client (first hit before the analytics beacon, JS/cookies
        // disabled, direct API): mint a vid server-side, use it as the quota key,
        // and upgrade the client to vid keying from its next request via Set-Cookie.
        vid = crypto.randomUUID();
        setVidCookie = `bys_vid=${vid}; Max-Age=31536000; Path=/; SameSite=Lax${sharedDomainAttr(requestHost(req))}`;
      }
      // M1 (security/fairness fix): the IP abuse cap is checked FIRST, before
      // the vid counter is touched — otherwise an IP-cap rejection would have
      // burned the visitor's one free review (vid incremented to 1, then 402).
      // A real dad on a bot-flooded IP now keeps his free review; retry after a
      // failed IP check won't hit vidCount=2.
      const ipCount = await incrementAnonReview(ip);
      if (ipCount > ANON_IP_DAILY_CAP) {
        return json3({ error: "You've used today's free review. It resets tomorrow — or create a free account for 5 reviews a month." }, 402, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
      }
      // Lazy vid gate (polish r1, QA 99d7894e): READ-ONLY check — the anon
      // slot is claimed only after a genuine success below, so a failed review
      // (empty stream, abort, timeout, killed function) never consumes it.
      const vidCount = await anonReviewVidUsed(vid);
      if (vidCount > 0) {
        return json3({ error: "You've used today's free review. It resets tomorrow — or create a free account for 5 reviews a month." }, 402, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
      }
    }
  }
  const streamHeaders = setVidCookie ? { "Set-Cookie": setVidCookie } : {};
  const key = cacheKey(draft + attachKeySuffix(attachments));
  // Examples may READ the cache (a repeated example draft streams from cache —
  // fewer LLM calls under an ad burst) but never WRITE it (see cacheSet below).
  const cached = cacheGet(key);
  if (cached && cached.length > 0) {
    const lines = cached;
    const enc2 = new TextEncoder;
    // P1 (2026-08-13): with the lazy claim, a dropped cache replay has claimed
    // nothing — only the anon IP abuse cap (incremented at request start) is
    // given back. vercel-entry never calls stream.cancel() on client disconnect
    // (the runtime aborts __bysSignal and the body pump just breaks), so the
    // signal listener is the primary path; cancel() is the serve.ts secondary.
    // The refunded flag prevents double refunds; example reviews increment
    // nothing, so they never refund.
    let dropped = false, refunded = false;
    const doRefund = () => {
      if (refunded || example) return;
      refunded = true;
      if (!session) refundAnonReview(ip).catch((e2) => console.warn("[review] cache ip refund failed:", e2));
    };
    const stream3 = new ReadableStream({
      async start(controller) {
        inFlightReviews += 1;
        const reqSignal2 = (req as unknown as { __bysSignal?: AbortSignal }).__bysSignal;
        const onAbort = () => { dropped = true; };
        if (reqSignal2) reqSignal2.addEventListener("abort", onAbort, { once: true });
        try {
          controller.enqueue(enc2.encode(JSON.stringify({ type: "start", mode: llm ? "live" : "demo" }) + `\n`));
          for (const l of lines) {
            if (dropped) break;
            controller.enqueue(enc2.encode(l + `\n`));
            await sleep(6);
          }
          if (!dropped) {
            controller.enqueue(enc2.encode(JSON.stringify({ type: "done" }) + `\n`));
            // Lazy quota claim (polish r1 + P1 2026-08-13): the slot is claimed
            // only after a fully-delivered replay — a dropped cache replay
            // claims nothing. Signed-in credits/monthly counters included.
            if (!example) {
              if (session) { if (claimSignedIn) await claimSignedIn(); }
              else await incrementAnonReviewVid(vid).catch((e2) => console.warn("[stream] cache vid count failed:", e2));
            }
            controller.close();
          }
        } catch { /* post-abort enqueue throws — nothing to deliver */ }
        finally {
          if (reqSignal2) reqSignal2.removeEventListener("abort", onAbort);
          if (dropped) doRefund();
          inFlightReviews -= 1;
        }
      },
      cancel() { doRefund(); }
    });
    return streamResponse(stream3, streamHeaders);
  }
  if (!llm && !fallbackAllowed) {
    return json3({
      error: "Live review isn't configured yet — an AI provider key is required. This is a temporary setup issue, not a problem with your message."
    }, 503);
  }
  const mode = llm ? "live" : "demo";
  const enc = new TextEncoder;
  const collected = [];
  // Client-abort propagation: the client's disconnect cancels this stream's
  // ReadableStream, which calls cancel() below — aborting the LLM fetch so an
  // abandoned review never pins a provider connection for the full timeout.
  const ac = new AbortController();
  // Connection-drop path (vercel-entry wires the Node ServerResponse 'close'
  // into this signal): abort the LLM fetch the moment the visitor's connection
  // dies mid-stream, so the failure catch refunds the quota slot instead of the
  // stream completing server-side unseen.
  const reqSignal = (req as unknown as { __bysSignal?: AbortSignal }).__bysSignal;
  if (reqSignal) reqSignal.addEventListener("abort", () => ac.abort(), { once: true });
  if (reqSignal?.aborted) ac.abort();
  const stream2 = new ReadableStream({
    async start(controller) {
      inFlightReviews += 1;
      controller.enqueue(enc.encode(JSON.stringify({ type: "start", mode }) + `
`));
      try {
        let gen;
        if (llm) {
          gen = streamLLMEvents(draft + attachmentContext(attachments), ac.signal);
        } else {
          const events = fallbackEvents(draft);
          gen = async function* () {
            for (const ev of events) {
              yield ev;
              await sleep(14);
            }
          }();
        }
        for await (const ev of gen) {
          collected.push(ev);
          controller.enqueue(enc.encode(ev + `
`));
        }
        // P0 (2026-08-12, QA ef5768a4): a generation that produced ZERO usable
        // events is a failure, not a success — throw BEFORE the done line so
        // the catch below refunds the quota slot and emits a calm error event
        // instead of streaming start+done with nothing (the silent dead-end:
        // button back to idle, no results, no error, review_completed fired).
        if (collected.length === 0) {
          const emptyErr = new Error("AI provider error: empty response");
          (emptyErr as { code?: string }).code = "empty_stream";
          throw emptyErr;
        }
        controller.enqueue(enc.encode(JSON.stringify({ type: "done" }) + `
`));
        // Lazy quota claim (polish r1 + P1 2026-08-13): the slot is claimed
        // ONLY after a genuinely successful stream — anon vid, signed-in
        // credit, or signed-in monthly counter. The old design incremented at
        // request start and refunded fire-and-forget in the catch — a
        // killed/crashed function (slow provider → platform limit) never ran
        // the refund, the counter sat at 1, and "Try again" hit 402. Now a
        // failure can never consume the slot; the claim is awaited so it lands
        // before the stream closes.
        if (!example) {
          if (session) { if (claimSignedIn) await claimSignedIn(); }
          else await incrementAnonReviewVid(vid).catch((e2) => console.warn("[review] vid count failed:", e2));
          cacheSet(key, collected);
        }
      } catch (err) {
        // Calm, on-brand error copy: provider/transient failures (rate limit,
        // timeout, abort, connection drop, empty message) get the "busy right
        // now" line; anything else keeps the plain fallback. Never a raw
        // developer string (a SambaNova 429 must never look like HIS billing
        // problem).
        let message = err instanceof Error ? err.message : "The review failed. Please try again.";
        // P0 (2026-08-12): carry the failure code (empty_stream) onto the error event so the client review_failed meta is specific, not "unknown".
        const errCode = (err as { code?: string })?.code;
        if (!message || /AI provider error|aborted|timeout|timed out|terminated|fetch failed|ECONNRESET/i.test(message)) {
          message = "We're getting a lot of requests right now — give it a minute and try again. This try didn't use your free review.";
        }
        // P1 (2026-08-13): no quota refund needed on failure — the claim is
        // lazy (success-only), so nothing was consumed. The anon IP counter is
        // the per-day abuse cap and is still given back so a genuine timeout
        // doesn't inch a real dad toward the cap. Example reviews never
        // incremented anything.
        if (!example && !session) {
          refundAnonReview(ip).catch((e2) => console.warn("[review] ip refund failed:", e2));
        }
        // Example resilience (Codex defense-in-depth): the labeled homepage
        // example must ALWAYS complete — when a provider failure hits the
        // example path, nothing streamed, and the client has not aborted,
        // replay the deterministic sample and finish cleanly. Real drafts
        // never take this branch; they keep the honest error event below.
        if (example && collected.length === 0 && !ac.signal.aborted) {
          try {
            for (const ev of fallbackEvents(draft)) {
              controller.enqueue(enc.encode(ev + `
`));
            }
            controller.enqueue(enc.encode(JSON.stringify({ type: "done" }) + `
`));
          } catch {}
        } else {
          try {
            controller.enqueue(enc.encode(JSON.stringify({ type: "error", message, ...(errCode ? { code: errCode } : {}) }) + `
`));
          } catch {}
        }
      } finally {
        try {
          controller.close();
        } catch {}
        inFlightReviews -= 1;
      }
    },
    cancel(reason) {
      ac.abort();
    }
  });
  return streamResponse(stream2, streamHeaders);
}
// ---- Situation Analyzer (two-mode AI Co-Parent, owner 2026-08-11) ----
// POST /api/analyze — mirrors /api/review exactly: same NDJSON event envelope
// (start{mode}/section/para/item/rewrite/rwtext/done/error), same in-memory
// cache (keys namespaced "a:" so a review and an analysis of the same text
// never collide), same 45s provider deadline + lazy quota claim, same quota pool
// (bys_user_review_usage + anonymous daily counters — 5/mo free, 30 Steady,
// unlimited Command/Ultimate). Body: { situation }.
async function handleAnalyze(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Send a JSON body with a situation." }, 400);
  }
  const situation = typeof body.situation === "string" ? body.situation.trim() : "";
  if (!situation)
    return json3({ error: "Describe what happened first." }, 400);
  if (situation.length > 5000)
    return json3({ error: "That description is over 5,000 characters — try a shorter version." }, 400);
  const parsedAtt = parseAttachments(body);
  if (!parsedAtt.ok) return json3({ error: parsedAtt.error }, 400);
  const attachments = parsedAtt.attachments;
  // Concurrency guard: shared with reviews — one per-instance pool.
  if (inFlightReviews >= MAX_CONCURRENT) {
    return json3({ error: "We're getting a lot of requests right now — give it a minute and try again." }, 503);
  }
  // Example flag (review 873604d6 A2/A3): /api/analyze mirrors /api/review —
  // no client sends example:true today, but declaring the flag keeps the
  // cache/live quota claims symmetric with review so a future example replay
  // can never claim an anonymous slot or write cache.
  const example = body.example === true;
  const session = getSession(req);
  // Attachment gate (Steady+, owner 2026-08-11): effective tier must be
  // steady/command/ultimate (userTier covers gift-month recipients). Rejected
  // BEFORE any quota decrement so a free dad's uses are never burned by a
  // refused attachment request.
  if (attachments.length > 0) {
    if (!session) return json3({ error: ATTACH_402 }, 402);
    const au = (await readUsers()).find((x2) => x2.id === session.userId);
    if (!au) return json3({ error: "Account not found. Please sign in again." }, 404);
    const at = userTier(au);
    if (at !== "steady" && at !== "command" && at !== "ultimate") return json3({ error: ATTACH_402 }, 402);
  }
  // Quota bookkeeping (same mechanics as /api/review): the anon IP counter is
  // the per-day abuse cap; claimSignedIn is the success-time claim for
  // signed-in credits / monthly counters (P1 2026-08-13 — nothing consumed on
  // failure).
  const ip = clientIp(req);
  let vid = visitorVid(req);
  let claimSignedIn = null;
  let setVidCookie = null;
  if (session) {
    const users = await readUsers();
    const u = users.find((x2) => x2.id === session.userId);
    if (!u)
      return json3({ error: "Account not found. Please sign in again." }, 404);
    const credits = Number(u.profile?.credits || 0);
    if (credits > 0) {
      // Credits path: READ-ONLY gate here — the credit is claimed only after
      // a successful stream (lazy, like the anon slot), so a failed or
      // killed stream can never burn a paid credit.
      claimSignedIn = () => readUsers().then((users2) => {
        const u2 = users2.find((x3) => x3.id === u.id);
        if (u2 && Number(u2.profile?.credits || 0) > 0) {
          u2.profile = { ...u2.profile || {}, credits: Number(u2.profile?.credits || 0) - 1 };
          return writeUsers(users2);
        }
      }).catch((err) => console.warn("[analyze] credit claim failed:", err));
    } else {
      const limit = reviewLimitFor(u);
      if (Number.isFinite(limit)) {
        // Shared pool with reviews: READ-ONLY pre-check; the per-user-month
        // counter is incremented only AFTER a successful stream, so a
        // failed/killed attempt never consumes a slot (P1 2026-08-13).
        const used = await userReviewUsage(u.id);
        if (used >= limit) {
          const msg = u.profile?.tier === "steady" ? `You've used this month's ${limit} uses — reviews and analyses together. They renew on the 1st.` : "You've used this month's 5 free uses — reviews and analyses together. They renew on the 1st.";
          return json3({ error: msg }, 402);
        }
        claimSignedIn = () => incrementUserReview(u.id).catch((e2) => console.warn("[analyze] user-count claim failed:", e2));
      }
    }
  } else {
    if (!vid) {
      vid = crypto.randomUUID();
      setVidCookie = `bys_vid=${vid}; Max-Age=31536000; Path=/; SameSite=Lax${sharedDomainAttr(requestHost(req))}`;
    }
    // IP abuse cap first (never burn the vid's free use on an IP rejection).
    const ipCount = await incrementAnonReview(ip);
    if (ipCount > ANON_IP_DAILY_CAP) {
      return json3({ error: "You've used today's free use. It resets tomorrow — or create a free account for 5 uses a month." }, 402, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
    }
    // Lazy vid gate (polish r1): same as /api/review — read-only check, the
    // anon slot is claimed only after a genuine success.
    const vidCount = await anonReviewVidUsed(vid);
    if (vidCount > 0) {
      return json3({ error: "You've used today's free use. It resets tomorrow — or create a free account for 5 uses a month." }, 402, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
    }
  }
  const streamHeaders = setVidCookie ? { "Set-Cookie": setVidCookie } : {};
  // Same cache, namespaced key ("a:" prefix) so a review and an analysis of the
  // same text can never serve each other's events.
  const key = "a:" + cacheKey(situation + attachKeySuffix(attachments));
  const cached = cacheGet(key);
  if (cached && cached.length > 0) {
    const lines = cached;
    const enc2 = new TextEncoder;
    // P1 (2026-08-13, /api/analyze mirror): with the lazy claim, a dropped
    // cache replay has claimed nothing — only the anon IP abuse cap
    // (incremented at request start) is given back. Signal listener primary,
    // cancel() secondary; refunded flag prevents double refunds.
    let dropped = false, refunded = false;
    const doRefund = () => {
      if (refunded) return;
      refunded = true;
      if (!session) refundAnonReview(ip).catch((e2) => console.warn("[analyze] cache ip refund failed:", e2));
    };
    const stream3 = new ReadableStream({
      async start(controller) {
        inFlightReviews += 1;
        const reqSignal2 = (req as unknown as { __bysSignal?: AbortSignal }).__bysSignal;
        const onAbort = () => { dropped = true; };
        if (reqSignal2) reqSignal2.addEventListener("abort", onAbort, { once: true });
        try {
          controller.enqueue(enc2.encode(JSON.stringify({ type: "start", mode: llm ? "live" : "demo" }) + `\n`));
          for (const l of lines) {
            if (dropped) break;
            controller.enqueue(enc2.encode(l + `\n`));
            await sleep(6);
          }
          if (!dropped) {
            controller.enqueue(enc2.encode(JSON.stringify({ type: "done" }) + `\n`));
            // Lazy anon claim (polish r1): the slot is claimed only after a
            // fully-delivered replay — a dropped cache replay claims nothing.
            if (!example && !session) await incrementAnonReviewVid(vid).catch((e2) => console.warn("[stream] cache vid count failed:", e2));
            controller.close();
          }
        } catch { /* post-abort enqueue throws — nothing to deliver */ }
        finally {
          if (reqSignal2) reqSignal2.removeEventListener("abort", onAbort);
          if (dropped) doRefund();
          inFlightReviews -= 1;
        }
      },
      cancel() { doRefund(); }
    });
    return streamResponse(stream3, streamHeaders);
  }
  if (!llm && !fallbackAllowed) {
    return json3({
      error: "Live analysis isn't configured yet — an AI provider key is required. This is a temporary setup issue, not a problem with your situation."
    }, 503);
  }
  const mode = llm ? "live" : "demo";
  const enc = new TextEncoder;
  const collected = [];
  // Client-abort propagation (same as /api/review): the visitor's disconnect
  // cancels the stream, which aborts the LLM fetch and refunds the quota slot.
  const ac = new AbortController();
  const reqSignal = (req as unknown as { __bysSignal?: AbortSignal }).__bysSignal;
  if (reqSignal) reqSignal.addEventListener("abort", () => ac.abort(), { once: true });
  if (reqSignal?.aborted) ac.abort();
  const stream2 = new ReadableStream({
    async start(controller) {
      inFlightReviews += 1;
      controller.enqueue(enc.encode(JSON.stringify({ type: "start", mode }) + `
`));
      try {
        let gen;
        if (llm) {
          gen = streamLLMEvents(situation + attachmentContext(attachments), ac.signal, ANALYZE_SYSTEM_PROMPT, ANALYZE_SECTION_MAP, ANALYZE_SECTION_TITLES);
        } else {
          const events = analyzeFallbackEvents(situation);
          gen = async function* () {
            for (const ev of events) {
              yield ev;
              await sleep(14);
            }
          }();
        }
        for await (const ev of gen) {
          collected.push(ev);
          controller.enqueue(enc.encode(ev + `
`));
        }
        // P0 (2026-08-12): same empty-generation guard as /api/review — a
        // contentless analysis must refund and show the calm error, never a
        // silent done-with-nothing.
        if (collected.length === 0) {
          const emptyErr = new Error("AI provider error: empty response");
          (emptyErr as { code?: string }).code = "empty_stream";
          throw emptyErr;
        }
        controller.enqueue(enc.encode(JSON.stringify({ type: "done" }) + `
`));
        // Lazy quota claim (polish r1 + P1 2026-08-13): same as /api/review —
        // the slot is claimed only after a genuinely successful analysis; a
        // failed/killed attempt never consumes a credit or monthly slot.
        if (!example) {
          if (session) { if (claimSignedIn) await claimSignedIn(); }
          else await incrementAnonReviewVid(vid).catch((e2) => console.warn("[analyze] vid count failed:", e2));
          cacheSet(key, collected);
        }
      } catch (err) {
        // Calm, on-brand error copy (mirrors the review path).
        let message = err instanceof Error ? err.message : "The analysis failed. Please try again.";
        const errCode = (err as { code?: string })?.code;
        if (!message || /AI provider error|aborted|timeout|timed out|terminated|fetch failed|ECONNRESET/i.test(message)) {
          message = "We're getting a lot of requests right now — give it a minute and try again. This try didn't use your free use.";
        }
        // P1 (2026-08-13): no quota refund needed on failure — the claim is
        // lazy (success-only). The anon IP abuse cap is still given back so a
        // genuine timeout doesn't inch a real dad toward the cap.
        if (!session) refundAnonReview(ip).catch((e2) => console.warn("[analyze] ip refund failed:", e2));
        try {
          controller.enqueue(enc.encode(JSON.stringify({ type: "error", message, ...(errCode ? { code: errCode } : {}) }) + `
`));
        } catch {}
      } finally {
        try {
          controller.close();
        } catch {}
        inFlightReviews -= 1;
      }
    },
    cancel(reason) {
      ac.abort();
    }
  });
  return streamResponse(stream2, streamHeaders);
}
var EMAIL_RE2 = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function handleSave(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request body." }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE2.test(email)) {
    return json3({ error: "That email address doesn't look right." }, 400);
  }
  // H3b: save mints a confirm token, so it shares the confirm-link rate limits
  // (per email + per IP) — no minting spray without hitting a wall.
  const ip = clientIp(req);
  if (await confirmRateHit(`confirm:email:${email}`, 3, 600000))
    return json3({ error: "Too many requests — please wait a few minutes and try again." }, 429);
  if (await confirmRateHit(`confirm:ip:${ip}`, 5, 600000))
    return json3({ error: "Too many requests — please wait a few minutes and try again." }, 429);
  // H3d (takeover guard, must run BEFORE minting): never mint a confirm token
  // for an email that already has a confirmed account or a password — that was
  // the unauthenticated takeover path (mint for the victim's email, confirm,
  // session as victim). The honest answer is "sign in instead".
  const existingUser = (await readUsers()).find((u) => u.email === email);
  if (existingUser && (existingUser.confirmedAt || existingUser.password))
    return json3({ error: "This email already has an account — sign in instead." }, 409);
  const draft = typeof body.draft === "string" ? body.draft.slice(0, 5000) : "";
  const review = typeof body.review === "string" ? body.review.slice(0, 12000) : "";
  // P2.2 (honesty, capture-moment redesign): never let a canned example review
  // be "saved" to an account. The client never offers it for example results,
  // and the server refuses it outright (payload flag OR exact canned draft —
  // byte-identical to EXAMPLE_DRAFT in ReviewTool.tsx / ReviewResults.tsx).
  const EXAMPLE_DRAFT_SAVE = `Can you please stop being so unreasonable? You never let me see the kids when it suits you, and you're always making excuses. I'm tired of your games — if this keeps up, I'll have my attorney take you back to court. The kids deserve better than how you treat them, and everyone knows it.`;
  if (body.example === true || (draft && draft.trim() === EXAMPLE_DRAFT_SAVE))
    return json3({ error: "That's the sample message — paste your own draft to save a review." }, 400);
  const row = {
    ts: new Date().toISOString(),
    email,
    draft,
    review,
    vid: visitorVid(req)
  };
  try {
    if (process.env.DATABASE_URL) {
      const sql = neon(process.env.DATABASE_URL);
      await sql`
        CREATE TABLE IF NOT EXISTS bys_signups (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT now(),
          email TEXT NOT NULL,
          draft TEXT,
          review TEXT
        )`;
      await sql`
        INSERT INTO bys_signups (email, draft, review)
        VALUES (${row.email}, ${row.draft || null}, ${row.review || null})`;
    } else {
      await addSignup(row);
    }
    // Batch 1 (abandoned-capture purge): every save sweeps rows older than 90
    // days — a dad who never finished the signup has his draft quietly
    // forgotten. Fire-and-forget: a purge failure never fails the save.
    purgeOldSignups(90).catch((e2) => console.warn("[review] signup purge failed:", e2));
    const confirmToken = token();
    // Durable in Neon (bys_confirm_tokens) so the link works across serverless
    // instances / cold starts — never a serverless-local Map. purpose='signup',
    // delivered=false until a real email send confirms otherwise; bound to the
    // minting browser's bys_vid so /api/auth/confirm only accepts it from THIS
    // browser (one-time + 30-min TTL + the rate limits above as the rest of the
    // mitigation). Pre-creating a row for an arbitrary email is inherent to
    // in-app confirm without email (pre-existing design); the takeover vector
    // is what's eliminated: a confirmed/password account can never be
    // token-logged into, and a token minted in browser A can't be used from B.
    await upsertConfirmToken(confirmToken, email, Date.now() + 1800000, "signup", false, visitorVid(req));
    const confirmResult = await sendConfirmation(email, `${new URL(req.url).origin}/confirm?token=${confirmToken}`);
    if (confirmResult.error)
      return json3({ error: confirmResult.error }, 503);
    if (!confirmResult.sent) {
      // Email unconfigured (owner direction: in-app confirm): hand the token
      // back to THIS browser instead of dead-ending the signup with a 503. The
      // token is vid-bound, one-time, and rate-limited — returning it here is
      // the intended "continue in the app" flow, NOT an open link leak.
      return json3({ ok: true, next: "confirm", sent: false, token: confirmToken, link: "/confirm?token=" + encodeURIComponent(confirmToken) });
    }
    // Email was actually delivered: mark delivered and do NOT return the token
    // in the response — "check your inbox" is the honest next step.
    await upsertConfirmToken(confirmToken, email, Date.now() + 1800000, "signup", true, visitorVid(req));
    return json3({ ok: true, next: "confirm", sent: true });
  } catch (err) {
    console.error("[review] save failed:", err);
    return json3({ error: "Couldn't save right now — please try again." }, 500);
  }
}
// Batch 1 (abandoned-capture purge): a dad who changed his mind can remove
// the draft he typed on the landing page — no account needed; the confirm
// token he holds is the key. vid-guarded like the confirm token itself (H3e):
// only the browser that created the capture can remove it. Old rows without a
// vid are still removable (nothing to bind them to).
async function handleSignupRemove(req) {
  let b2;
  try {
    b2 = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const t = typeof b2.token === "string" ? b2.token : "";
  if (!t || t.length > 128)
    return json3({ error: "We couldn't find those details — they may already be removed." }, 404);
  const pending = await getConfirmToken(t);
  if (!pending) {
    purgeExpiredConfirmTokens().catch(() => {});
    return json3({ error: "We couldn't find those details — they may already be removed." }, 404);
  }
  if (pending.vid && pending.vid !== visitorVid(req)) {
    await deleteConfirmToken(t);
    return json3({ error: "We couldn't find those details — they may already be removed." }, 404);
  }
  await deleteSignups(pending.email);
  await deleteConfirmToken(t);
  return json3({ ok: true });
}
var AUTH_SECRET = process.env.AUTH_SECRET || "bys-dev-secret-change-me";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Fast in-memory cache for auth sessions. The durable source of truth is the
// bys_auth_sessions table in Neon (see storage.ts); this Map only exists to skip
// a DB read for repeat requests on the same warm instance. warmSession() in
// handleApiRequest hydrates it from the DB on cold starts, so a login written to
// the DB survives instance recycling and deploys.
var sessions = new Map;
function token(n = 32) {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, n - 32);
}
async function hashPassword(password, salt = crypto.randomUUID()) {
  const { scrypt } = await import("node:crypto");
  return new Promise((resolve, reject) => scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`scrypt:${salt}:${Buffer.from(key).toString("hex")}`)));
}
async function verifyPassword(password, stored) {
  const { scrypt, timingSafeEqual: timingSafeEqual2 } = await import("node:crypto");
  const [, salt, expected] = stored.split(":");
  return new Promise((resolve) => scrypt(password, salt, 64, (err, key) => {
    if (err)
      return resolve(false);
    const actual = Buffer.from(key).toString("hex");
    resolve(actual.length === expected.length && timingSafeEqual2(Buffer.from(actual), Buffer.from(expected)));
  }));
}
function requestHost(req: Request): string {
  return req.headers.get("host") || new URL(req.url).host;
}
// Scope a cookie to the shared apex domain when the request arrives on
// beforeyousend.org or www.beforeyousend.org (both serve 200 with no redirect,
// so a host-only cookie set on one is silently absent on the other). Preview
// aliases (*.vercel.app) keep host-only cookies — a Domain=.beforeyousend.org
// cookie would never be sent to a vercel.app host anyway.
function sharedDomainAttr(host: string): string {
  return host === "beforeyousend.org" || host.endsWith(".beforeyousend.org") ? "; Domain=.beforeyousend.org" : "";
}
function cookie(name, value, maxAge, host?: string) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}${host ? sharedDomainAttr(host) : ""}`;
}
// Collect every bys_session cookie value in Cookie-header order. RFC 6265 §5.4
// sends the OLDEST matching cookie first — pre-fix builds (before 2026-08-09)
// set host-only bys_session cookies on apex/www, and one of those stale
// host-only cookies is sent BEFORE the valid Domain=.beforeyousend.org cookie a
// later login set. Scanning all values and taking the first VALID session makes
// the stale cookie harmless instead of a hard 401.
function sessionTokens(req: Request): string[] {
  const raw = req.headers.get("cookie");
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === "bys_session") out.push(part.slice(eq + 1).trim());
  }
  return out;
}
// Set-Cookie header(s) for a session write. On the real domains we write the
// Domain=.beforeyousend.org cookie. When SETTING a session (login, confirm,
// password, signup) we return ONLY that domain cookie — WebKit matches a
// host-only "Max-Age=0" delete against it by name+path and would wipe the
// session we just set. Stale host-only shadows are harmless: sessionTokens()
// scans all bys_session cookies and takes the first VALID one. When CLEARING
// (logout / account delete / expired clear) we also send the host-only delete
// so the jar is fully empty on every browser. On *.vercel.app aliases
// (host-only by design) only the session cookie is ever written: a host-only
// clear there would delete the cookie we just set.
function sessionCookies(req: Request, value: string, maxAge: number): string[] {
  const host = requestHost(req);
  const sc = cookie("bys_session", value, maxAge, host);
  if (!sharedDomainAttr(host)) return [sc];
  // Setting a session on the real domains: write ONLY the Domain=.beforeyousend.org
  // cookie. WebKit matches a host-only "bys_session=; Max-Age=0" delete against the
  // domain-scoped cookie by name+path and would wipe the session we just set, so the
  // heal-clear must never ride along in a login/confirm/signup response. Stale
  // host-only shadows are harmless — sessionTokens() scans all bys_session cookies
  // and takes the first VALID one, so a stale dead token is skipped server-side.
  if (value !== "") return [sc];
  // Clearing (logout / account delete / expired clear): delete BOTH the domain
  // cookie and the host-only shadow so the jar is fully empty on every browser.
  return [sc, "bys_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"];
}
export function getSession(req: Request) {
  for (const raw of sessionTokens(req)) {
    const s = sessions.get(raw);
    if (!s || s.exp < Date.now()) {
      if (s) sessions.delete(raw);
      continue;
    }
    // Slide the expiry (fire-and-forget) so an active user never goes stale.
    const exp = Date.now() + SESSION_TTL_MS;
    s.exp = exp;
    upsertAuthSession(raw, s.userId, exp).catch(() => {});
    return { ...s, token: raw };
  }
  return null;
}
// Hydrate the in-memory session cache from the durable DB on cold starts.
// Called once at the top of handleApiRequest before routing, so every handler
// keeps working with the synchronous getSession() above. Scans all bys_session
// cookies in header order and stops at the first one that resolves in the DB —
// a stale leading cookie no longer blocks a valid one behind it.
var SESSION_VERIFY_MS = 5 * 60 * 1000;
// M4 fix: cached entries are re-validated against the durable DB on a short TTL
// (lastVerified). A session revoked or deleted on another instance (logout,
// account delete, admin purge) must die here too — previously the Map entry
// survived until instance recycle and getSession()'s slide re-upsert would
// RESURRECT the deleted DB row on the next hit. Missing/expired rows evict the
// entry and skip the slide. One indexed PK lookup per session per 5-min window.
async function warmSession(req: Request) {
  for (const raw of sessionTokens(req)) {
    const cached = sessions.get(raw);
    if (cached) {
      if (Date.now() - (cached.lastVerified || 0) < SESSION_VERIFY_MS) continue;
      try {
        const dbS = await getAuthSession(raw);
        if (!dbS || dbS.exp <= Date.now()) {
          sessions.delete(raw);
          if (dbS) deleteAuthSession(raw).catch(() => {});
          continue;
        }
        cached.lastVerified = Date.now();
        cached.exp = dbS.exp;
        return;
      } catch (err) {
        console.warn("[session] verify failed:", err);
      }
      continue;
    }
    try {
      const dbS = await getAuthSession(raw);
      if (!dbS) {
        purgeExpiredAuthSessions().catch(() => {});
        continue;
      }
      if (dbS.exp <= Date.now()) {
        deleteAuthSession(raw).catch(() => {});
        continue;
      }
      sessions.set(raw, { userId: dbS.userId, exp: dbS.exp, lastVerified: Date.now() });
      // Refresh the DB expiry so the session slides while the user is active.
      upsertAuthSession(raw, dbS.userId, Date.now() + SESSION_TTL_MS).catch(() => {});
      return;
    } catch (err) {
      console.warn("[session] warm failed:", err);
    }
  }
}
async function sendConfirmation(email, link2) {
  const key = process.env.EMAIL_API_KEY;
  if (!key) {
    // Email is not integrated (by design): never log the link to console — the
    // caller decides what to do with {sent:false} (in-app confirm flow).
    return { sent: false, link: link2 };
  }
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM || "Before You Send <no-reply@beforeyousend.app>", to: [email], subject: "Confirm your Before You Send account", html: `<p>Confirm your account: <a href="${link2}">Set your password</a></p>` }) });
  if (!res.ok)
    return { sent: false, error: "Email provider rejected the message." };
  return { sent: true };
}
async function handleConfirmLink(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE2.test(email))
    return json3({ error: "Enter a valid email address." }, 400);
  // H3b: rate-limit per email + per IP, durable in Neon so serverless instances
  // share the same counter (in-memory Map fallback when no DB).
  const ip = clientIp(req);
  if (await confirmRateHit(`confirm:email:${email}`, 3, 600000))
    return json3({ error: "Too many requests — please wait a few minutes and try again." }, 429);
  if (await confirmRateHit(`confirm:ip:${ip}`, 5, 600000))
    return json3({ error: "Too many requests — please wait a few minutes and try again." }, 429);
  const purpose = body.purpose === "signin" ? "signin" : "signup";
  const users = await readUsers();
  const existingUser = users.find((u) => u.email === email);
  if (purpose === "signin") {
    // Sign-in tokens re-login an EXISTING confirmed account. They are minted
    // ONLY when the email actually leaves the server (delivered), and never
    // returned in-app. With email unconfigured this path honestly refuses —
    // no fake "check your inbox".
    if (!existingUser || !(existingUser.confirmedAt || existingUser.password))
      return json3({ error: "No account found with that email — create a free account instead." }, 404);
    const t = token();
    await upsertConfirmToken(t, email, Date.now() + 1800000, "signin", false, visitorVid(req));
    const link2 = `${new URL(req.url).origin}/confirm?token=${t}`;
    const result = await sendConfirmation(email, link2);
    if (result.error)
      return json3({ error: result.error }, 503);
    if (!result.sent) {
      await deleteConfirmToken(t);
      return json3({ error: "Email sign-in isn't set up yet — sign in with the password you set." }, 503);
    }
    await upsertConfirmToken(t, email, Date.now() + 1800000, "signin", true, visitorVid(req));
    return json3({ ok: true, sent: true });
  }
  // H3d (takeover guard, before minting): never mint a signup token for an
  // email that already has a confirmed account or a password.
  if (existingUser && (existingUser.confirmedAt || existingUser.password))
    return json3({ error: "This email already has an account — sign in instead." }, 409);
  const t = token();
  // See handleSave for the purpose/delivered/vid contract: in-app confirm when
  // email is unconfigured (token returned to THIS vid-bound browser only).
  await upsertConfirmToken(t, email, Date.now() + 1800000, "signup", false, visitorVid(req));
  const link2 = `${new URL(req.url).origin}/confirm?token=${t}`;
  const result = await sendConfirmation(email, link2);
  if (result.error)
    return json3({ error: result.error }, 503);
  if (!result.sent) {
    // Email unconfigured (owner direction: in-app confirm) — return the token
    // for the "Continue in the app →" flow, never a dead-end 503.
    return json3({ ok: true, sent: false, token: t, link: "/confirm?token=" + encodeURIComponent(t) });
  }
  await upsertConfirmToken(t, email, Date.now() + 1800000, "signup", true, visitorVid(req));
  return json3({ ok: true, sent: true });
}
// Login intake (owner 2026-08-13): the 3 questions on /login ride into the
// account at confirm — whitelist the exact chip values so arbitrary strings
// can never be stored. Unknown/absent keys are dropped; all three must be
// present for the intake to be stored (profile.intake JSONB).
var INTAKE_ALLOWED = ["custody_dispute", "co_parent_conflict", "schedule_logistics", "communication_only", "calm_replies", "keeping_record", "staying_organized", "knowing_whats_fair", "all_of_it", "calmer_messages", "full_record", "organized_evidence", "someone_to_talk"];
function sanitizeIntake(raw) {
  if (!raw || typeof raw !== "object") return null;
  var out = {};
  for (var k of ["q1", "q2", "q3"]) {
    var v = raw[k];
    if (typeof v === "string" && INTAKE_ALLOWED.includes(v)) out[k] = v;
  }
  return out.q1 && out.q2 && out.q3 ? out : null;
}
// Email-only account confirmation (use-first funnel, owner 2026-08-10): a valid
// confirm token creates the account and signs the visitor in WITHOUT a password —
// the /confirm password wall is deferred. Uses the same durable token table and
// the same session-heal cookie path as handlePassword, so the login-persistence
// fix (multi-cookie scan + host-only clear) is preserved exactly.
async function handleConfirm(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const t = typeof body.token === "string" ? body.token : "";
  const intake = sanitizeIntake(body.intake);
  const pending = await getConfirmToken(t);
  if (!pending) {
    purgeExpiredConfirmTokens().catch(() => {});
    return json3({ error: "This confirmation link is invalid or expired." }, 400);
  }
  if (pending.exp < Date.now()) {
    await deleteConfirmToken(t);
    return json3({ error: "This confirmation link is invalid or expired." }, 400);
  }
  // H3e (stolen-link guard): tokens are bound to the browser that minted them
  // (bys_vid cookie). A token without a vid, or used from a different browser,
  // is invalid — a leaked/stolen link can't confirm from anywhere but the
  // original browser. (The /confirm resend re-mints for the current browser.)
  const requestVid = visitorVid(req);
  if (!pending.vid || pending.vid !== requestVid) {
    await deleteConfirmToken(t);
    return json3({ error: "This confirmation link is invalid or expired." }, 400);
  }
  const users = await readUsers();
  const existing = users.find((u) => u.email === pending.email);
  if (pending.purpose === "signin") {
    // Sign-in token: MAY re-login an existing confirmed account (delete token,
    // set session). Only minted when email delivery actually succeeded
    // (delivered=true), so this branch is dormant while email is unconfigured.
    if (!existing || !(existing.confirmedAt || existing.password)) {
      await deleteConfirmToken(t);
      return json3({ error: "This confirmation link is no longer valid." }, 400);
    }
    await deleteConfirmToken(t);
    const st = token();
    const exp = Date.now() + SESSION_TTL_MS;
    // A2 (owner's auto-logout report): persist the session in Neon BEFORE
    // minting it in the Map and handing out the cookie — a DB write failure
    // returns a retryable 500 instead of a 200 with a Map-only session that
    // dies on the next instance recycle (the hard logout the owner hit).
    try {
      await upsertAuthSession(st, existing.id, exp);
    } catch (err) {
      console.error("[auth] session persist failed:", err);
      return json3({ error: "We couldn't start your session — please try again in a moment." }, 500);
    }
    sessions.set(st, { userId: existing.id, exp, lastVerified: Date.now() });
    return json3({ ok: true, user: { id: existing.id, email: existing.email, profile: existing.profile } }, 200, { "Set-Cookie": sessionCookies(req, st, 2592000) });
  }
  // H3c (security fix): a signup token may ONLY confirm an account that does
  // not exist yet, or an unconfirmed password-less account created by this same
  // email-only flow. It must NEVER mint a session into an already-confirmed
  // account (confirmedAt set, or a password) — that was the unauthenticated
  // takeover: mint a token for the victim's email, confirm, session as victim.
  if (existing && (existing.confirmedAt || existing.password)) {
    await deleteConfirmToken(t);
    return json3({ error: "This confirmation link is no longer valid." }, 400);
  }
  let user = existing;
  if (!user) {
    user = { id: crypto.randomUUID(), email: pending.email, createdAt: new Date().toISOString(), profile: {} };
    users.push(user);
  }
  if (intake) user.profile = { ...(user.profile || {}), intake };
  user.confirmedAt = new Date().toISOString();
  // M3 (audit de2c7f92): at account creation, adopt this email's landing-capture
  // drafts into the NEW account's own review rows (userId-stamped, timestamps
  // preserved) — then consume the email-keyed signup rows so no other account
  // can ever read them by email. Idempotent: the signup rows are deleted here,
  // so a re-run finds nothing to copy.
  var signupAdopt = (await signupReviews(user.email)).filter((x) => (x.draft && String(x.draft).trim()) || (x.review && String(x.review).trim())); // P1.1: skip empty quiz/capture rows
  // B2 (QA 79568d67): a login-page signup (no capture) has zero signup rows —
  // hadReview tells /confirm whether a review was genuinely adopted, so its
  // "This review is saved to your record" copy is only shown when true.
  var hadReview = signupAdopt.length > 0;
  if (signupAdopt.length) {
    await writeReviews((await readReviews()).concat(signupAdopt.map(function (x) { return { id: crypto.randomUUID(), userId: user.id, draft: x.draft, blocks: [], review: x.review, createdAt: x.ts }; })));
    await deleteSignups(user.email);
  }
  await writeUsers(users);
  await deleteConfirmToken(t);
  const st = token();
  const exp = Date.now() + SESSION_TTL_MS;
  // A2 (owner's auto-logout report): persist the session in Neon BEFORE
  // minting it in the Map and handing out the cookie — a DB write failure
  // returns a retryable 500 instead of a 200 with a Map-only session that
  // dies on the next instance recycle (the hard logout the owner hit).
  try {
    await upsertAuthSession(st, user.id, exp);
  } catch (err) {
    console.error("[auth] session persist failed:", err);
    return json3({ error: "We couldn't start your session — please try again in a moment." }, 500);
  }
  sessions.set(st, { userId: user.id, exp, lastVerified: Date.now() });
  return json3({ ok: true, user: { id: user.id, email: user.email, profile: user.profile, hadReview } }, 200, { "Set-Cookie": sessionCookies(req, st, 2592000) });
}
async function handlePassword(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const t = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8)
    return json3({ error: "Use at least 8 characters." }, 400);
  const users = await readUsers();
  // Session-authenticated set-password (no token): the signed-in user sets a
  // password for THEIR OWN account — the session already IS the account, so
  // there is no takeover surface. Powers the /confirm success card and the
  // dashboard "Set a password" item (optional, tiny ask — not a wall). The
  // token lookup below is deliberately skipped when no token is supplied.
  if (!t) {
    const s = getSession(req);
    if (!s)
      return json3({ error: "Sign in to set a password." }, 400);
    const su = users.find((x2) => x2.id === s.userId);
    if (!su)
      return json3({ error: "Account not found. Please sign in again." }, 404);
    if (su.password) {
      // Batch 1 (password CHANGE + session-authenticated reset): a session IS
      // the account (email reset is not configured), so the signed-in dad
      // changes his password with the current one, or sets a new one with
      // reset:true when he's forgotten it. Literal true only — a truthy
      // string never bypasses the check.
      if (body.reset !== true) {
        const cur = typeof body.currentPassword === "string" ? body.currentPassword : "";
        if (!cur)
          return json3({ error: "Enter your current password." }, 400);
        if (!await verifyPassword(cur, su.password))
          return json3({ error: "That's not the current password — try again." }, 400);
      }
      su.password = await hashPassword(password);
      await writeUsers(users);
      return json3({ ok: true, user: { id: su.id, email: su.email, profile: su.profile } }, 200);
    }
    su.password = await hashPassword(password);
    await writeUsers(users);
    return json3({ ok: true, user: { id: su.id, email: su.email, profile: su.profile } }, 200);
  }
  const pending = await getConfirmToken(t);
  if (!pending) {
    // Token unknown (used, purged, or never issued) — opportunistically sweep
    // expired rows and fail cleanly, never a 500.
    purgeExpiredConfirmTokens().catch(() => {});
    return json3({ error: "This confirmation link is invalid or expired." }, 400);
  }
  if (pending.exp < Date.now()) {
    await deleteConfirmToken(t);
    return json3({ error: "This confirmation link is invalid or expired." }, 400);
  }
  // H3c guard (same class as handleConfirm): a token must never overwrite an
  // existing confirmed account's password — that would be account takeover.
  const existing2 = users.find((u) => u.email === pending.email);
  if (existing2 && (existing2.confirmedAt || existing2.password)) {
    await deleteConfirmToken(t);
    return json3({ error: "This confirmation link is no longer valid." }, 400);
  }
  let user = existing2;
  if (!user) {
    user = { id: crypto.randomUUID(), email: pending.email, createdAt: new Date().toISOString(), profile: {} };
    users.push(user);
  }
  user.password = await hashPassword(password);
  user.confirmedAt = new Date().toISOString();
  // M3 (audit de2c7f92): same account-creation adoption as handleConfirm —
  // the email's landing-capture drafts become the new account's own rows, and
  // the email-keyed signup rows are consumed so nothing addressable by email
  // remains.
  var signupAdopt = (await signupReviews(user.email)).filter((x) => (x.draft && String(x.draft).trim()) || (x.review && String(x.review).trim())); // P1.1: skip empty quiz/capture rows
  if (signupAdopt.length) {
    await writeReviews((await readReviews()).concat(signupAdopt.map(function (x) { return { id: crypto.randomUUID(), userId: user.id, draft: x.draft, blocks: [], review: x.review, createdAt: x.ts }; })));
    await deleteSignups(user.email);
  }
  await writeUsers(users);
  await deleteConfirmToken(t);
  const st = token();
  const exp = Date.now() + SESSION_TTL_MS;
  // A2 (owner's auto-logout report): persist the session in Neon BEFORE
  // minting it in the Map and handing out the cookie — a DB write failure
  // returns a retryable 500 instead of a 200 with a Map-only session that
  // dies on the next instance recycle (the hard logout the owner hit).
  try {
    await upsertAuthSession(st, user.id, exp);
  } catch (err) {
    console.error("[auth] session persist failed:", err);
    return json3({ error: "We couldn't start your session — please try again in a moment." }, 500);
  }
  sessions.set(st, { userId: user.id, exp, lastVerified: Date.now() });
  return json3({ ok: true, user: { id: user.id, email: user.email, profile: user.profile } }, 200, { "Set-Cookie": sessionCookies(req, st, 2592000) });
}
async function handleLogin(req) {
  let b2;
  try {
    b2 = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const users = await readUsers();
  // Email match is case-insensitive on BOTH sides: the capture/confirm flow
  // stores lowercased emails, but a row can legitimately carry mixed case
  // (direct-seeded accounts, legacy imports). A case-sensitive compare here
  // locked those dads out with the correct password.
  const loginEmail = String(b2.email || "").trim().toLowerCase();
  const u = users.find((x2) => String(x2.email || "").trim().toLowerCase() === loginEmail);
  if (!u || !u.password || !await verifyPassword(String(b2.password || ""), u.password))
    return json3({ error: "Email or password is incorrect." }, 401);
  const st = token();
  const exp = Date.now() + SESSION_TTL_MS;
  // A2 (owner's auto-logout report): persist the session in Neon BEFORE
  // minting it in the Map and handing out the cookie — a DB write failure
  // returns a retryable 500 instead of a 200 with a Map-only session that
  // dies on the next instance recycle (the hard logout the owner hit).
  try {
    await upsertAuthSession(st, u.id, exp);
  } catch (err) {
    console.error("[auth] session persist failed:", err);
    return json3({ error: "We couldn't start your session — please try again in a moment." }, 500);
  }
  sessions.set(st, { userId: u.id, exp, lastVerified: Date.now() });
  return json3({ ok: true, user: { id: u.id, email: u.email, profile: u.profile } }, 200, { "Set-Cookie": sessionCookies(req, st, 2592000) });
}
// DIRECT email+password signup (owner 2026-08-13, intake step 4): a fresh
// visitor answers Q1→Q2→Q3 on /login, then creates their free account
// INSTANTLY with email + password — no email-wait, no confirm hop. This is the
// /login happy path; /quiz and /confirm keep the email-only confirm-link flow
// untouched. Mirrors handleConfirm's account adoption (free tier defaults,
// confirmed_at, M3 landing-draft adoption, sanitizeIntake whitelist into
// profile.intake) + handlePassword/handleLogin's password hashing and session
// minting. NO email is ever sent (email is not integrated — honest); the
// session cookie IS the "you're in". Analytics stay client-fired exactly like
// the confirm path (email_submitted -> email_captured + account_created with
// meta.source intake-direct/direct), so bys_events is never double-counted.
async function handleSignup(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || email.length > 254 || !EMAIL_RE2.test(email))
    return json3({ error: "Enter a valid email address." }, 400);
  if (password.length < 8)
    return json3({ error: "Use at least 8 characters." }, 400);
  // H3b: signup mints sessions, so it shares the confirm-link rate limits
  // (per email + per IP, durable in Neon) — no account-spray without a wall.
  const ip = clientIp(req);
  if (await confirmRateHit(`confirm:email:${email}`, 3, 600000))
    return json3({ error: "Too many requests — please wait a few minutes and try again." }, 429);
  if (await confirmRateHit(`confirm:ip:${ip}`, 5, 600000))
    return json3({ error: "Too many requests — please wait a few minutes and try again." }, 429);
  const intake = sanitizeIntake(body.intake);
  const users = await readUsers();
  const existing = users.find((u) => u.email === email);
  // H3d (takeover guard): never adopt or overwrite an account that already has
  // confirmed_at or a password — the honest answer is "sign in instead". The
  // 409 copy never distinguishes "exists" vs "doesn't" beyond that.
  if (existing && (existing.confirmedAt || existing.password))
    return json3({ error: "That email already has an account — sign in instead." }, 409);
  let user = existing;
  if (!user) {
    user = { id: crypto.randomUUID(), email, createdAt: new Date().toISOString(), profile: {} };
    users.push(user);
  }
  if (intake) user.profile = { ...(user.profile || {}), intake };
  user.password = await hashPassword(password);
  user.confirmedAt = new Date().toISOString();
  // M3 (audit de2c7f92): same account-creation adoption as handleConfirm — the
  // email's landing-capture drafts become the new account's own rows (userId-
  // stamped, timestamps preserved), then the email-keyed signup rows are
  // consumed so no other account can ever read them by email. Idempotent: a
  // re-run finds nothing to copy.
  var signupAdopt = (await signupReviews(user.email)).filter((x) => (x.draft && String(x.draft).trim()) || (x.review && String(x.review).trim())); // P1.1: skip empty quiz/capture rows
  var hadReview = signupAdopt.length > 0;
  if (signupAdopt.length) {
    await writeReviews((await readReviews()).concat(signupAdopt.map(function (x) { return { id: crypto.randomUUID(), userId: user.id, draft: x.draft, blocks: [], review: x.review, createdAt: x.ts }; })));
    await deleteSignups(user.email);
  }
  await writeUsers(users);
  const st = token();
  const exp = Date.now() + SESSION_TTL_MS;
  // A2 (owner's auto-logout report): persist the session in Neon BEFORE
  // minting it in the Map and handing out the cookie — a DB write failure
  // returns a retryable 500 instead of a 200 with a Map-only session that
  // dies on the next instance recycle (the hard logout the owner hit).
  try {
    await upsertAuthSession(st, user.id, exp);
  } catch (err) {
    console.error("[auth] session persist failed:", err);
    return json3({ error: "We couldn't start your session — please try again in a moment." }, 500);
  }
  sessions.set(st, { userId: user.id, exp, lastVerified: Date.now() });
  return json3({ ok: true, user: { id: user.id, email: user.email, profile: user.profile, hadReview } }, 200, { "Set-Cookie": sessionCookies(req, st, 2592000) });
}
// 24-hour free trial grant (owner 2026-08-13). Owner-gated like the other
// account APIs: signed in + free + no prior trial -> create the row (24h,
// source=trial_modal) and mirror expires_at onto profile.trialUntil so the
// synchronous userTier() gate upgrades the whole account to the full paid
// experience immediately. Signed in + effective paid -> honest 409. Already
// trialed (row exists, active or spent) -> honest 409 — one per person, ever.
// Anonymous -> calm 401 pointing at the free account (the client routes
// through the existing email capture). Idempotent + race-safe: bys_trials
// user_id PK makes a concurrent second grant a no-op; if the insert returns
// nothing the row already existed and we 409 instead of double-starting.
async function handleTrialStart(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Create your free account to start your trial — it takes about 10 seconds." }, 401);
  let users = null;
  try {
    users = await readUsers();
  } catch (err) {
    console.warn("[trial] users read failed:", err);
  }
  if (!users)
    return json3({ error: "Could not start your trial right now — please try again in a minute." }, 503);
  const u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  if (userTier(u) !== "free")
    return json3({ error: "You already have full access — no trial needed." }, 409);
  const existing = await getTrial(u.id).catch(() => null);
  if (existing)
    return json3({ error: existing.expiresAt && new Date(existing.expiresAt).getTime() > Date.now() ? "Your free trial is already active — you're all set." : "You've already used your free trial." }, 409);
  const { row, created } = await startTrial(u.id, "trial_modal");
  if (!row || !created)
    return json3({ error: "You've already used your free trial." }, 409);
  u.profile = { ...(u.profile || {}), trialUntil: row.expiresAt };
  try { await writeUsers(users); } catch (err) { console.warn("[trial] profile mirror failed:", err); }
  addEvent({ vid: visitorVid(req) || "server", name: "trial_start", meta: { source: "trial_modal" } }).catch(function (err) { console.warn("[trial] event failed:", err); });
  return json3({ ok: true, expiresAt: row.expiresAt });
}
async function authMe(req) {
  const s = getSession(req);
  if (!s)
    return json3({ user: null }, 401);
  // L7: a Neon hiccup on the very first users read must NOT 500 the session
  // check (that class of failure logged everyone out on 2026-08-10). Treat a
  // failed read as signed-out — same pattern as the organizerTrialCount guard.
  let users = null;
  try {
    users = await readUsers();
  } catch (err) {
    console.warn("[authMe] users read failed, treating as signed out:", err);
  }
  if (!users)
    return json3({ user: null }, 401);
  const u = users.find((x2) => x2.id === s.userId);
  if (!u) {
    // M4: the user row is gone (account deleted) — evict the cached session so
    // it stops authenticating and can't be resurrected by the slide re-upsert.
    sessions.delete(s.token);
    deleteAuthSession(s.token).catch(() => {});
    return json3({ user: null }, 401);
  }
  // Batch 2 (child id stability): backfill stable ids on first READ — legacy
  // profiles carry name-only children. The folder's ratings/todos/log tags key
  // on the id, so every child gets one (write-once; idempotent once assigned).
  var kidList = Array.isArray(u.profile?.children) ? u.profile.children : [];
  var needsKidBackfill = kidList.some(function (c) { return !c || typeof c.id !== "string" || !c.id; });
  if (needsKidBackfill) {
    u.profile = { ...(u.profile || {}), children: kidList.map(function (c) { return c && typeof c.id === "string" && c.id ? c : { ...(c || {}), id: crypto.randomUUID() }; }) };
    try { await writeUsers(users); } catch (err) { console.warn("[authMe] child id backfill failed:", err); }
  }
  // 24-hour free trial: the bys_trials row is the durable record; mirror its
  // expires_at onto profile.trialUntil so the synchronous userTier() gate
  // sees the window (and it self-expires on the same timestamp). Read failure
  // degrades to trial=null — the account still loads; the client treats a
  // missing trial field as no-trial.
  let trial: { active: boolean; expiresAt: string | null; used: boolean } | null = null;
  try {
    const tr = await getTrial(u.id);
    if (tr) {
      const exp = new Date(tr.expiresAt).getTime();
      trial = { active: exp > Date.now(), expiresAt: tr.expiresAt, used: true };
      const cur = u.profile?.trialUntil ? new Date(u.profile.trialUntil).getTime() : 0;
      if (Math.abs(cur - exp) > 1000) {
        u.profile = { ...(u.profile || {}), trialUntil: tr.expiresAt };
        try { await writeUsers(users); } catch (err) { console.warn("[authMe] trial mirror backfill failed:", err); }
      }
    } else {
      trial = { active: false, expiresAt: null, used: false };
    }
  } catch (err) {
    console.warn("[authMe] trial read failed, treating as no trial:", err);
  }
  const tier = userTier(u);
  const limit = TIER_LIMITS[tier];
  // M2: the quota display reflects streams (per-user-month counter) as well as saved rows, so 'remaining' stays honest when a user streams without saving.
  // AUTH HOTFIX: a quota-read failure (table missing on a brand-new DB before
  // init finishes, transient Neon hiccup) must NEVER log the user out. Any
  // throw degrades to used=null/remaining=null (quota shows unknown); the real
  // review gate still runs at stream-start in the review endpoint.
  let used: number | null = null;
  if (Number.isFinite(limit)) {
    try {
      used = Math.max(await reviewsThisMonth(u.id), await userReviewUsage(u.id));
    } catch (err) {
      console.warn("[authMe] quota read failed, keeping user authenticated with unknown quota:", err);
    }
  }
  let orgTrialCount = 0;
  try {
    orgTrialCount = await organizerTrialCount("user:" + u.id);
  } catch (err) {
    console.warn("[authMe] organizer trial read failed, keeping user authenticated:", err);
  }
  // Batch 1 (Sort My Pile expiry trap): tell the client whether the dad has
  // filed papers — a lapsed Sort My Pile buyer keeps read/delete/export on
  // his own files. Read failure degrades to hasAny=false (UI treats it as
  // locked; the server gate is the real authority).
  let hasOrgFiles = false;
  try {
    hasOrgFiles = (await readOrganizerFilesMeta(u.id)).length > 0;
  } catch (err) {
    console.warn("[authMe] organizer files read failed:", err);
  }
  return json3({
    user: { id: u.id, email: u.email, profile: u.profile, hasPassword: !!u.password, isOwner: String(u.email).trim().toLowerCase() === String(process.env.OWNER_EMAIL || "").trim().toLowerCase() },
    quota: {
      tier,
      limit: Number.isFinite(limit) ? limit : null,
      used,
      remaining: Number.isFinite(limit) && used !== null ? Math.max(0, limit - used) : null,
      credits: Number(u.profile?.credits || 0)
    },
    organizerTrial: { used: orgTrialCount >= ORGANIZER_TRIAL_LIMIT, remaining: Math.max(0, ORGANIZER_TRIAL_LIMIT - orgTrialCount), count: orgTrialCount },
    organizerFiles: { hasAny: hasOrgFiles },
    trial,
    entitlements: {
      // Attorney Prep Pack: Ultimate tier OR a durable paid grant. Server-side
      // authority (never trust the client); the pricing card reads this to show
      // "Already included in Ultimate" / "unlocked" instead of a Buy button.
      attorneyPrep: attorneyPrepEntitled(u),
// Record Review (2026-08-13): purchased grant (permanent) OR Ultimate
      // 1/year allowance. Server-side authority (never trust the client); the
      // pricing card reads this to show "Record Review unlocked" / "Already
      // included in Ultimate" instead of a Buy button. Read failure degrades
      // to not-entitled (Buy button) — never a false unlock.
      recordReview: await recordReviewEntitlement(u).catch(() => ({ entitled: false, kind: "none" }))
    }
  }, 200, { "Set-Cookie": sessionCookies(req, s.token, 2592000) });
}
async function authLogout(req) {
  const s = getSession(req);
  if (s) {
    sessions.delete(s.token);
    deleteAuthSession(s.token).catch(() => {});
  }
  return json3({ ok: true }, 200, { "Set-Cookie": sessionCookies(req, "", 0) });
}
async function handleAccountDelete(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers();
  const u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  await deleteUserData(u.id, u.email);
  sessions.delete(s.token);
  deleteAuthSession(s.token).catch(() => {});
  return json3({ ok: true }, 200, { "Set-Cookie": sessionCookies(req, "", 0) });
}
async function handleLog(req, method, id) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const all = await readLog();
  if (method === "GET")
    return json3({ logs: all.filter((x2) => x2.userId === u.id).sort((a2, b3) => String(b3.date).localeCompare(String(a2.date))) });
  if (method === "DELETE") {
    const next = all.filter((x2) => !(x2.userId === u.id && x2.id === id));
    await writeLog(next);
    return json3({ ok: true });
  }
  let b2;
  try {
    b2 = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  if (method === "PATCH" || method === "PUT") {
    const row2 = all.find((x2) => x2.userId === u.id && x2.id === id);
    if (!row2)
      return json3({ error: "Entry not found." }, 404);
    if (typeof b2.message === "string")
      row2.message = b2.message.slice(0, 1e4);
    if (b2.direction === "sent" || b2.direction === "received")
      row2.direction = b2.direction;
    if (typeof b2.date === "string" && b2.date)
      row2.date = b2.date;
    if (typeof b2.topic === "string")
      row2.topic = b2.topic.slice(0, 80);
    if (typeof b2.notes === "string")
      row2.notes = b2.notes.slice(0, 5000);
    // Batch 2 (Design 1): optional child-folder tag (the child's stable id).
    // A present-but-empty string clears the tag on edit.
    if (typeof b2.child === "string")
      row2.child = b2.child.trim().slice(0, 40) || undefined;
    // Calm-loop tone (gentle|direct|firm|as-wrote|neutral) — set only by the
    // did-you-send one-tap log or the manual form. L5 fix: an explicit empty
    // string CLEARS a manual tone on edit; the auto-stamped 'reviewed'
    // provenance is never clearable or changeable through this endpoint (it
    // stays write-only from the one-tap log's POST path).
    if (typeof b2.tone === "string") {
      if (b2.tone === "") {
        if (row2.tone !== "reviewed") row2.tone = undefined;
      } else if (["gentle", "direct", "firm", "as-wrote", "neutral"].includes(b2.tone)) {
        if (row2.tone !== "reviewed") row2.tone = b2.tone;
      }
    }
    row2.updatedAt = new Date().toISOString();
    await writeLog(all);
    return json3({ ok: true, log: row2 });
  }
  const message = typeof b2.message === "string" ? b2.message.trim().slice(0, 1e4) : "";
  if (!message)
    return json3({ error: "Message text is required." }, 400);
  const tone = typeof b2.tone === "string" && ["gentle", "direct", "firm", "as-wrote", "reviewed", "neutral"].includes(b2.tone) ? b2.tone : undefined;
  // One-tap-log dedupe (calm-loop slice 1): the did-you-send "Yes, sent" tap
  // is idempotent per user/message/day — a re-tap must never duplicate the
  // entry. Only the auto-logged "reviewed" tone participates; manual Add-form
  // entries never carry tone, so they are never deduped away.
  if (tone === "reviewed") {
    const existing = await findRecentReviewedLog(u.id, message);
    if (existing)
      return json3({ ok: true, log: existing });
  }
  // L4 (slice-2 fix): the auto provenance line is the ONE-TAP LOG's signature
  // (tone === "reviewed") only. Manual tones (gentle|direct|firm|neutral)
  // store the dad's OWN notes — a manual "Gentle" entry must never be stamped
  // "Auto-logged after a review." (false provenance).
  const notes = tone === "reviewed" ? "Auto-logged after a review." : (typeof b2.notes === "string" ? b2.notes.slice(0, 5000) : "");
  const childTag = typeof b2.child === "string" && b2.child.trim() ? b2.child.trim().slice(0, 40) : undefined;
  const row = { id: crypto.randomUUID(), userId: u.id, message, direction: b2.direction === "received" ? "received" : "sent", date: typeof b2.date === "string" && b2.date ? b2.date : new Date().toISOString(), topic: typeof b2.topic === "string" ? b2.topic.slice(0, 80) : "other", notes, tone, child: childTag, createdAt: new Date().toISOString() };
  all.push(row);
  await writeLog(all);
  return json3({ ok: true, log: row }, 201);
}
// ---- Review events (calm-loop slice 1) --------------------------------------
// One row per completed dashboard review — the data under the Momentum card
// (7-day count + last-3 trend) and the weekly digest (deferred). Idempotent by
// client id; free for every signed-in user (no quota interaction, no rate cap:
// 1 POST per completed review, fired once per page session).
var REVIEW_TONES = ["gentle", "direct", "firm", "as-wrote", "reviewed"];
// L1: per-user/day silent cap on review-event POSTs (protects the owner-funded
// Neon DB from unbounded authenticated writes). Generous — a dad posts 1-5/day.
// The handler returns 200 with the client-shaped row on overflow (no 429, no
// error surface — the Momentum card just doesn't count that row).
const REVIEW_EVENTS_DAY_CAP = 60;
async function handleReviewEvents(req, method, id) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  if (method === "GET") {
    const [count, recent] = await Promise.all([reviewEventsWeekCount(u.id), reviewEventsRecent(u.id, 3)]);
    // recent comes back newest-first; the momentum sparkline wants oldest-first.
    return json3({ ok: true, week: { count }, recent: recent.reverse() });
  }
  if (method === "PATCH") {
    let b2;
    try { b2 = await req.json(); } catch { return json3({ error: "Invalid request." }, 400); }
    const patch = {};
    // Only sentStatus "sent" is ever persisted — "not yet" is never recorded.
    if (b2.sentStatus === "sent") patch.sentStatus = "sent";
    if (typeof b2.sentTone === "string" && REVIEW_TONES.includes(b2.sentTone)) patch.sentTone = b2.sentTone;
    if (typeof b2.reviewId === "string" && b2.reviewId) patch.reviewId = b2.reviewId.slice(0, 64);
    const ev = await updateReviewEventSent(u.id, id, patch);
    if (!ev)
      return json3({ error: "Event not found." }, 404);
    return json3({ ok: true, event: ev });
  }
  let b2;
  try { b2 = await req.json(); } catch { return json3({ error: "Invalid request." }, 400); }
  const rid = typeof b2.id === "string" ? b2.id : "";
  if (!rid || rid.length < 1 || rid.length > 64)
    return json3({ error: "Invalid event id." }, 400);
  if (typeof b2.draft !== "string" || b2.draft.length > 5000)
    return json3({ error: "Draft must be a string of at most 5000 characters." }, 400);
  if (!Array.isArray(b2.blocks) || b2.blocks.length > 200)
    return json3({ error: "Blocks must be an array of at most 200 items." }, 400);
  const reviewId = typeof b2.reviewId === "string" && b2.reviewId ? b2.reviewId.slice(0, 64) : undefined;
  const { score, flags } = computeImpactScore(b2.blocks);
  // L1 silent cap: past 60 POSTs today the row is simply not stored — the
  // response still says ok and carries the client's own id (silent no-op).
  if ((await reviewEventsCountToday(u.id)) >= REVIEW_EVENTS_DAY_CAP)
    return json3({ ok: true, event: { id: rid, score, flags, createdAt: new Date().toISOString() } });
  const row = await insertReviewEvent({ id: rid, userId: u.id, reviewId, draftHash: cacheKey(b2.draft), score, flags });
  // Idempotent by client id: if the id collides with another user's row, the
  // insert no-ops and the SELECT returns THEIR row — never claim it as ours.
  if (row.userId !== u.id)
    return json3({ error: "Forbidden." }, 403);
  return json3({ ok: true, event: { id: row.id, score, flags, createdAt: row.createdAt } });
}
// ---- Weekly digest (calm-loop slice 2 — Steady+) ----------------------------
// In-app card for Steady+ (incl. gift recipients via userTier). Read-only,
// auth'd, own rows only — no quota interaction, no rate cap. The 402 gate
// mirrors CASE_SUMMARY_402 exactly.
var DIGEST_402 = "Your weekly digest is part of the Steady plan.";
async function handleDigest(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  var tier = userTier(u);
  if (tier === "free") return json3({ error: DIGEST_402 }, 402);
  const d = await reviewEventsDigest(u.id);
  var trend = null;
  if (d.reviewed > 0 && d.prevAvg !== null && d.avg !== null) {
    if (d.avg > d.prevAvg) trend = "calmer";
    else if (d.avg === d.prevAvg) trend = "steady";
  }
  return json3({
    ok: true,
    week: {
      reviewed: d.reviewed,
      sent: d.sent,
      calmest: d.calmest,
      stormiest: d.stormiest,
      toneMix: d.toneMix
    },
    recent: d.recent,
    trend
  }, 200);
}
// ---- Give-a-month (calm-loop slice 2) ---------------------------------------
// A dad buys one month of Steady ($4.99, one-time) -> server mints a single-use
// BYS-XXXX-XXXX code -> he shares it himself -> recipient redeems -> 30 days of
// Steady via profile.giftUntil. Giver reward: nothing (honest default; any
// reciprocity is an owner decision — spec §10).
async function handleGiftPurchase(req) {
  if (!process.env.STRIPE_SECRET_KEY)
    return json3({ error: "Payments are not enabled yet — checkout will be active soon." }, 503);
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  const giftPrice = await resolveStripePrice(stripe, "gift", "month");
  const origin2 = new URL(req.url).origin;
  const giftSession = await stripe.checkout.sessions.create({
    mode: "payment",
    automatic_payment_methods: { enabled: true },
    line_items: [{ price: giftPrice, quantity: 1 }],
    managed_payments: { enabled: false },
    client_reference_id: s.userId,
    metadata: { plan: "gift", user_id: s.userId },
    success_url: `${origin2}/pricing?checkout=success&plan=gift&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin2}/pricing?checkout=cancelled`
  });
  return json3({ url: giftSession.url, plan: "gift", interval: "month" });
}
async function handleGiftCodes(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const codes = await giftCodesForGiver(u.id);
  return json3({
    ok: true,
    codes: codes.map((c2) => ({ code: c2.id, validUntil: new Date(new Date(c2.createdAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString() }))
  });
}
// L9: read-only code status for the redeem page's on-load recognition (a code
// already redeemed by THIS account re-shows success; used-by-other / expired
// show a calm state; unknown keeps the form). Never mutates — redeeming is
// exclusively the POST /api/gifts/redeem path.
async function handleGiftStatus(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  let code = "";
  try { code = (new URL(req.url).searchParams.get("code") || "").trim().toUpperCase(); } catch {}
  if (!code || code.length < 4 || code.length > 20)
    return json3({ error: "Enter the gift code from the dad who shared it." }, 400);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const g = await getGiftCode(code);
  if (!g)
    return json3({ ok: true, status: "unknown" });
  if (g.status !== "active")
    return json3({ ok: true, status: "used", redeemedByMe: g.redeemedBy === u.id });
  if (new Date(g.createdAt).getTime() < Date.now() - 90 * 24 * 60 * 60 * 1000)
    return json3({ ok: true, status: "expired" });
  return json3({ ok: true, status: "active" });
}
async function handleGiftRedeem(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  let body;
  try { body = await req.json(); } catch { return json3({ error: "Invalid request." }, 400); }
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code || code.length < 4 || code.length > 20)
    return json3({ error: "Enter the gift code from the dad who shared it." }, 400);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const g = await getGiftCode(code);
  if (!g)
    return json3({ error: "That code doesn't exist." }, 404);
  if (g.status !== "active")
    return json3({ error: "That code has already been used." }, 409);
  if (new Date(g.createdAt).getTime() < Date.now() - 90 * 24 * 60 * 60 * 1000)
    return json3({ error: "That code has expired." }, 410);
  if (g.giverId === u.id)
    return json3({ error: "This is your own gift code — share it with another dad." }, 400);
  const claimed = await redeemGiftCode(code, u.id);
  if (!claimed)
    return json3({ error: "That code has already been used." }, 409);
  // Roll forward from the latest of now / any banked gift / any paid renews-at,
  // so a gift redeemed under a paid account is banked, not wasted.
  const base = Math.max(Date.now(), new Date(u.profile?.giftUntil || 0).getTime(), new Date(u.profile?.tierRenewsAt || 0).getTime());
  const validUntil = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();
  u.profile = { ...u.profile || {}, giftUntil: validUntil };
  await writeUsers(users);
  return json3({ ok: true, validUntil });
}
async function handleReviews(req, method) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const all = await readReviews();
  if (method === "GET") {
    // M3 (audit de2c7f92): NO email-keyed merge. Landing-capture drafts were
    // adopted into this user's own bys_reviews rows at account creation, so
    // the user-scoped read is the whole truth — no other account (or attacker
    // with the same email) can ever surface them.
    const own = await readReviewsForUser(u.id);
    const sorted = own.sort((a2, b3) => String(b3.createdAt).localeCompare(String(a2.createdAt)));
    return json3({ reviews: userTier(u) === "free" ? sorted.slice(0, 10) : sorted });
  }
  let b2;
  try {
    b2 = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  if (method === "DELETE") {
    // P1 delete fix: the old filter-then-writeReviews path silently no-oped —
    // writeReviews is upsert-only and never issues DELETEs, so the row stayed
    // in the DB and the client got a fake {ok:true}. Now a real, user-scoped
    // DELETE; 404 when nothing was removed so the client can tell the dad
    // honestly instead of pretending it worked.
    const rid = typeof b2.id === "string" ? b2.id.slice(0, 64) : "";
    if (!rid || !(await deleteReview(u.id, rid)))
      return json3({ error: "That review wasn't found." }, 404);
    return json3({ ok: true });
  }
  if (method === "PATCH") {
    // Batch 1 (saved-review rename): the dad gives a saved review a short
    // name to find it by. Title is optional metadata — never required.
    const title = typeof b2.title === "string" ? b2.title.trim().slice(0, 120) : "";
    if (!title)
      return json3({ error: "A name needs at least one character." }, 400);
    const rid = typeof b2.id === "string" ? b2.id.slice(0, 64) : "";
    const row2 = all.find((x2) => x2.userId === u.id && x2.id === rid);
    if (!row2)
      return json3({ error: "That review wasn't found." }, 404);
    row2.title = title;
    await writeReviews(all);
    return json3({ ok: true, review: row2 });
  }
  const row = { id: crypto.randomUUID(), userId: u.id, draft: String(b2.draft || "").slice(0, 5000), blocks: Array.isArray(b2.blocks) ? b2.blocks.slice(0, 200) : [], review: String(b2.review || "").slice(0, 12000), createdAt: new Date().toISOString(), kind: b2.kind === "analysis" ? "analysis" : "review" };
  all.push(row);
  await writeReviews(all);
  if (userTier(u) === "free")
    await pruneReviews(u.id, 10);
  return json3({ ok: true, review: row });
}
async function handleProfile(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  let b2;
  try {
    b2 = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const users = await readUsers();
  const u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  // Onboarding payloads always send name+situation+help together; only run the
  // full overwrite when at least one of those keys is present, so a children-only
  // POST (Organizer child-folder capture) never wipes the dad's profile fields.
  if (b2.name !== undefined || b2.situation !== undefined || b2.help !== undefined) {
    u.profile = { ...u.profile || {}, name: String(b2.name || "").slice(0, 100), situation: Array.isArray(b2.situation) ? b2.situation.slice(0, 10) : [], help: Array.isArray(b2.help) ? b2.help.slice(0, 10) : [], completed: true };
  }
  // profile.children — JSONB merge (NEVER the full-overwrite path above): the
  // child's folder is the emotional centerpiece; first entry is the folder's
  // owner. Validate: array <= 4, name 1-40 chars, gender girl|boy or omitted.
  if (Array.isArray(b2.children)) {
    var kids = [];
    for (var ki = 0; ki < Math.min(b2.children.length, 4); ki++) {
      var k = b2.children[ki];
      if (!k || typeof k !== "object") continue;
      var kName = typeof k.name === "string" ? k.name.trim() : "";
      if (!kName || kName.length > 40) continue;
      var kGender = k.gender === "girl" || k.gender === "boy" ? k.gender : undefined;
      var kId = typeof k.id === "string" && k.id.length >= 1 && k.id.length <= 64 ? k.id : crypto.randomUUID();
      kids.push(kGender ? { id: kId, name: kName, gender: kGender } : { id: kId, name: kName });
    }
    var existing = Array.isArray(u.profile?.children) ? u.profile.children : [];
    // Batch 2 (child id stability): every child gets a stable internal id — the
    // folder's ratings/todos/log tags key on it, so a rename never orphans
    // them. Legacy children (name-only) are backfilled here on first write;
    // the merge below always preserves the existing slot's id.
    var backfilled = existing.map(function (c) { return c && typeof c.id === "string" && c.id ? c : { ...(c || {}), id: crypto.randomUUID() }; });
    if (b2.children.length === 0) {
      // Batch 1 (child folder REMOVE): an explicit empty array means the dad
      // removed the folder — the name comes off, his filed papers stay (they
      // are his own organizer rows, never keyed to the child slot). The
      // child-scoped Exchange Tone ratings + to-do lists go with the folder.
      u.profile = { ...u.profile || {}, children: [], weekRatings: {}, todos: {} };
    } else if (!kids.length) {
      return json3({ error: "A child's name needs at least one character." }, 400);
    } else if (kids.length === 1 && backfilled.length > 0) {
      // Batch 1 (child folder merge): a single-child POST from the capture
      // sheet is an edit of an existing folder, never a wipe of siblings.
      // Optional replaceName pins which slot when the name changed; otherwise
      // a matching name replaces in place, and an unknown name appends.
      var prevName = typeof b2.replaceName === "string" ? b2.replaceName.slice(0, 40) : "";
      var matchIdx = backfilled.findIndex(function (c) { return (c && c.name) === (prevName || kids[0].name); });
      if (matchIdx >= 0) {
        var nextKids = backfilled.slice();
        // Preserve the slot's id through renames (the incoming child carries
        // its own id, but the existing slot is the authority once assigned).
        nextKids[matchIdx] = { ...kids[0], id: backfilled[matchIdx]?.id || kids[0].id };
        u.profile = { ...u.profile || {}, children: nextKids };
      } else {
        u.profile = { ...u.profile || {}, children: backfilled.concat(kids).slice(0, 4) };
      }
    } else {
      u.profile = { ...u.profile || {}, children: kids };
    }
  }
  // Batch 2 (Design 1): one-tap weekly Exchange Tone rating — a dad's OWN
  // self-report per child per ISO week (YYYY-Www). Merge, never overwrite the
  // whole map; silently prune to the last 26 weeks per child.
  if (b2.weekRating && typeof b2.weekRating === "object" && !Array.isArray(b2.weekRating)) {
    var wr = b2.weekRating;
    var wrChild = typeof wr.child === "string" ? wr.child.trim().slice(0, 64) : "";
    var wrWeek = typeof wr.week === "string" && /^\d{4}-W\d{2}$/.test(wr.week) ? wr.week : "";
    var wrVal = wr.value === "calm" || wr.value === "mixed" || wr.value === "stormy" ? wr.value : "";
    if (wrChild && wrWeek && wrVal) {
      var wrMap = { ...(((u.profile || {}).weekRatings || {})[wrChild] || {}) };
      wrMap[wrWeek] = wrVal;
      var wrKeys = Object.keys(wrMap).sort().slice(-26);
      var wrNext = {};
      for (var wi = 0; wi < wrKeys.length; wi++) wrNext[wrKeys[wi]] = wrMap[wrKeys[wi]];
      u.profile = { ...u.profile || {}, weekRatings: { ...((u.profile || {}).weekRatings || {}), [wrChild]: wrNext } };
    }
  }
  // Batch 2 (Design 1): {Name}'s list — child-scoped manual to-dos keyed by
  // child id (full-array replace per child; the client sends the whole list).
  // Honest caps: <= 40 rows total, <= 20 OPEN items per child, text <= 120.
  if (Array.isArray(b2.todos)) {
    var tChild = typeof b2.todosChild === "string" ? b2.todosChild.trim().slice(0, 64) : "";
    var tArr = [];
    for (var ti = 0; ti < Math.min(b2.todos.length, 40); ti++) {
      var t = b2.todos[ti];
      if (!t || typeof t !== "object") continue;
      var tId = typeof t.id === "string" ? t.id.slice(0, 64) : "";
      var tText = typeof t.text === "string" ? t.text.trim().slice(0, 120) : "";
      if (!tId || !tText) continue;
      tArr.push({ id: tId, text: tText, done: t.done === true, createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString() });
    }
    if (!tChild)
      return json3({ error: "The list needs its folder." }, 400);
    if (tArr.filter(function (x) { return !x.done; }).length > 20)
      return json3({ error: "That's more than 20 open items — the list holds 20 at a time." }, 400);
    u.profile = { ...u.profile || {}, todos: { ...((u.profile || {}).todos || {}), [tChild]: tArr } };
  }
  await writeUsers(users);
  return json3({ ok: true, user: { id: u.id, email: u.email, profile: u.profile } });
}
var TIMELINE_CATEGORIES2 = ["exchange", "school", "medical", "communication", "court", "other"];
async function handleTimeline(req, method, id) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const all = await readTimeline();
  if (method === "GET")
    return json3({ timeline: all.filter((x2) => x2.userId === u.id).sort((a2, b3) => String(b3.date).localeCompare(String(a2.date))) });
  if (method === "DELETE") {
    const next = all.filter((x2) => !(x2.userId === u.id && x2.id === id));
    await writeTimeline(next);
    return json3({ ok: true });
  }
  let b2;
  try {
    b2 = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  if (method === "PATCH" || method === "PUT") {
    const row2 = all.find((x2) => x2.userId === u.id && x2.id === id);
    if (!row2)
      return json3({ error: "Entry not found." }, 404);
    if (typeof b2.date === "string" && b2.date)
      row2.date = b2.date.slice(0, 10);
    if (typeof b2.title === "string")
      row2.title = b2.title.trim().slice(0, 200);
    if (typeof b2.category === "string" && TIMELINE_CATEGORIES2.includes(b2.category))
      row2.category = b2.category;
    if (typeof b2.details === "string")
      row2.details = b2.details.trim().slice(0, 5000);
    row2.updatedAt = new Date().toISOString();
    await writeTimeline(all);
    return json3({ ok: true, item: row2 });
  }
  const date = typeof b2.date === "string" && b2.date ? b2.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const title = typeof b2.title === "string" ? b2.title.trim().slice(0, 200) : "";
  if (!title)
    return json3({ error: "Title is required." }, 400);
  const row = { id: crypto.randomUUID(), userId: u.id, date, title, category: TIMELINE_CATEGORIES2.includes(b2.category) ? b2.category : "other", details: typeof b2.details === "string" ? b2.details.trim().slice(0, 5000) : "", createdAt: new Date().toISOString() };
  all.push(row);
  await writeTimeline(all);
  return json3({ ok: true, item: row }, 201);
}
// ---- "The Organizer" demo (promo MVP) --------------------------------------
// Five free classifications per visitor EVER (1->5, preflight 766ccd02;
// account-keyed signed in, vid-keyed anonymous; per-IP daily cap for
// cookie-less bots, D2 raised to 25). Never touches the review quota; nothing
// is persisted for anonymous trials. Public name is "The Organizer" — "AI"
// appears nowhere in user-facing copy.
var ORGANIZER_FOLDER_BLURBS = {
  communication: "messages between the parents",
  schedule: "pickup/drop-off plans, exchanges, agreed times, changes to time with the kids",
  health: "medical records, appointments, medications, doctor notes, health insurance",
  school: "report cards, teacher emails, IEP/504 plans, school incidents, parent-teacher notes",
  finances: "child support, shared expenses, reimbursements, bills, receipts",
  legal: "court orders, agreements, filings, attorney correspondence, court-adjacent documents",
  other: "anything that does not clearly fit, or is too vague to classify"
};
// System prompt built from taxonomy.ts — the folder/subfolder list can never
// drift from what the client chips render.
function buildOrganizerPrompt() {
  var list = TAXONOMY.map(function (f) {
    return '- "' + f.slug + '" — ' + (ORGANIZER_FOLDER_BLURBS[f.slug] || "") + '. Subfolders: "' + f.subfolders.map(function (s) { return s.slug; }).join('", "') + '".';
  }).join("\n");
  return `You are the filing engine for "Before You Send", a calm organizing tool for separated or
divorced fathers in high-conflict co-parenting situations. A father gives you ONE item from
his co-parenting life: a message transcript, a bill, or a description of a screenshot/photo.
Your job: decide where this item belongs in his personal record so he can find it later —
as evidence if he ever needs it.

File it under EXACTLY one folder and one subfolder from this list:
${list}

Rules:
- Respond with ONLY a JSON object and nothing else: {"folder":"<slug>","category":"<subfolder-slug>","reason":"<one sentence>","summary":"<1-2 sentences>","tags":["<tag>","<tag>","<tag>"]}
- reason: ONE plain-English sentence, under 140 characters, saying why it belongs there. If the
  item mentions a date, amount, or person, name them ("Bill for the kids' dental visit, Mar 3").
  Never invent facts that are not in the item.
- summary: 1-2 plain-English sentences (under 280 characters total) describing WHAT this item
  is, so the father can recognize it years later. Name dates, amounts, and people when present
  ("Daycare bill for February, $380, from Little Sprouts"). Never invent facts not in the item.
- tags: 3-5 SHORT lowercase tags (each under 24 characters, no spaces — use hyphens), like
  ["child-support","feb-2026","daycare"]. Use concrete words from the item, never generic ones.
- If you cannot tell what the item is, use folder "other" and category "needs-sorting", and say
  honestly what is missing ("Can't tell what this is from the description alone").
- A hostile message that threatens court still belongs in "communication" — use "legal" only for
  an actual legal document. When in doubt between two folders, pick by the concrete content:
  money → "finances", a date/time about the kids → "schedule", health → "health".
- If the father describes a screenshot or photo, classify by HIS description — you cannot see the image.

Item:
`;
}
var ORGANIZER_SYSTEM_PROMPT = buildOrganizerPrompt();
// Whole-document sort prompt (REAL CONTENT SORT, owner 2026-08-11): the dad's
// paper arrives as its OWN extracted text (PDF/Word/.txt — read on his device),
// not a filename guess. Same taxonomy, same rails, plus a short recognizable
// title so the Organizer row reads like the real document. Scanned/photos
// never reach this prompt — the client marks them unreadable and they take the
// honest rule path below.
function buildSortPrompt() {
  var list = TAXONOMY.map(function (f) {
    return '- "' + f.slug + '" — ' + (ORGANIZER_FOLDER_BLURBS[f.slug] || "") + '. Subfolders: "' + f.subfolders.map(function (s) { return s.slug; }).join('", "') + '".';
  }).join("\n");
  return `You are the filing engine for "Before You Send", a calm organizing tool for separated or
divorced fathers in high-conflict co-parenting situations. A father gives you ONE document from
his co-parenting life: its full text (extracted from a PDF, Word file, or text file — the file
name and a one-line note from him are included for context). Your job: decide where this
document belongs in his personal record so he can find it later — as evidence if he ever needs it.

File it under EXACTLY one folder and one subfolder from this list:
${list}

Rules:
- Respond with ONLY a JSON object and nothing else: {"folder":"<slug>","category":"<subfolder-slug>","title":"<short recognizable name>","reason":"<one sentence>","summary":"<1-2 sentences>","tags":["<tag>","<tag>","<tag>"]}
- title: a SHORT recognizable name for the document, under 200 characters, like "Daycare bill, Feb — $380" or "IEP meeting notice, Mar 4". Use the paper's own words where you can.
- reason: ONE plain-English sentence, under 140 characters, saying why it belongs there. If the
  document mentions a date, amount, or person, name them ("Bill for the kids' dental visit, Mar 3").
  Never invent facts that are not in the text.
- summary: 1-2 plain-English sentences (under 280 characters total) describing WHAT this document
  is, so the father can recognize it years later. Name dates, amounts, and people when present
  ("Daycare bill for February, $380, from Little Sprouts"). Never invent facts not in the text.
- tags: 3-5 SHORT lowercase tags (each under 24 characters, no spaces — use hyphens), like
  ["child-support","feb-2026","daycare"]. Use concrete words FROM THE TEXT, never generic ones.
- If the text is empty, garbled, or too thin to place, use folder "other" and category
  "needs-sorting", and say honestly what is missing ("This looks scanned — no readable text").
- A hostile message that threatens court still belongs in "communication" — use "legal" only for
  an actual legal document. When in doubt between two folders, pick by the concrete content:
  money → "finances", a date/time about the kids → "schedule", health → "health".
- You are organizing the father's own records — never give legal advice, never claim anything is
  or isn't admissible in court.

Item:
`;
}
var ORGANIZER_SORT_SYSTEM_PROMPT = buildSortPrompt();
var ORGANIZER_TRIAL_402 = "You've used your 5 free organizer trials. The full Document Organizer is part of the Command Center plan.";
// 1->5 trial (2026-08-12, preflight 766ccd02): five free organizer trials per
// visitor; the count lives in bys_organizer_trial_usage.count (lazy ALTER).
var ORGANIZER_TRIAL_LIMIT = 5;
// Server-side dataUrl allowlist (M1): the client re-encodes images to webp and
// passes PDFs through as-is; direct API callers must be held to the same
// contract — image/png|jpeg|webp or application/pdf, base64 only.
var ORGANIZER_DATAURL_RE = /^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,/;
// Anonymous-trial IP abuse cap (M2): cookie-less clients mint a fresh vid per
// request, so only an IP counter can bound bots burning paid LLM calls.
var ORGANIZER_TRIAL_IP_DAILY_CAP = Number(process.env.ORGANIZER_TRIAL_IP_DAILY_CAP || 25); // D2: 10 -> 25 (5 trials/dad, CGNAT)
// Parse the model's JSON answer defensively: full JSON.parse, else first
// {..} block, then validate folder/category against the taxonomy (never let a
// bad model answer hard-fail the demo). Invalid folder → other/needs-sorting.
function extractOrganizerJson(raw, nameForTitle) {
  if (!raw) return null;
  var obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    var m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch {} }
  }
  if (!obj || typeof obj !== "object") return null;
  var folderSlug = typeof obj.folder === "string" ? obj.folder : "";
  var folder = folderBySlug(folderSlug);
  if (!folder) { folder = folderBySlug("other"); folderSlug = "other"; }
  var category = typeof obj.category === "string" ? obj.category : "";
  if (!folder.subfolders.some(function (s) { return s.slug === category; })) category = folder.subfolders[0].slug;
  var reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  if (!reason) reason = folderSlug === "other" ? "Can't tell what this is from the description alone." : "Filed under " + folder.label + ".";
  if (reason.length > 140) reason = reason.slice(0, 137) + "…";
  var summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!summary) summary = folderSlug === "other" ? "Can't tell what this is yet — add a line about what it is." : "A " + folder.label.toLowerCase() + " item, filed for easy finding.";
  if (summary.length > 300) summary = summary.slice(0, 297) + "…";
  var tags = null;
  if (Array.isArray(obj.tags)) {
    tags = obj.tags.map(function (t2) { return String(t2).trim().toLowerCase().replace(/\s+/g, "-").slice(0, 24); })
      .filter(Boolean).filter(function (t2, i, a) { return a.indexOf(t2) === i; }).slice(0, 5);
  }
  if (!tags || tags.length < 3) tags = [folder.slug, category, "needs-check"].filter(Boolean);
  // New title field (whole-document sort): short recognizable name, <=200 chars,
  // falling back to the cleaned file name when the model doesn't give one.
  var title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (title.length > 200) title = title.slice(0, 197) + "…";
  if (!title && nameForTitle) title = sortItemTitle(nameForTitle);
  return { folder: folder.slug, category, reason, summary, tags, title: title || null };
}
// One-shot JSON-mode classification. SambaNova JSON mode is unverified, so:
// response_format → 400 → one retry without it; extraction failures (and any
// network/HTTP error) fall back to the deterministic classifier. 30s deadline.
async function classifyOrganizerItem(itemText, nameForTitle, systemPrompt) {
  if (inFlightOrganizerClassify >= MAX_ORGANIZER_CLASSIFY)
    return fallbackOrganizerClassify(itemText);
  inFlightOrganizerClassify += 1;
  try {
  var attempt = function (jsonMode) {
    return fetch(llm.base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + llm.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llm.model,
        stream: false,
        temperature: 0.1,
        max_tokens: 400,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: systemPrompt || ORGANIZER_SYSTEM_PROMPT },
          { role: "user", content: itemText }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
  };
  var res = null;
  try {
    res = await attempt(true);
    if (res.status === 400) res = await attempt(false);
  } catch (err) {
    return fallbackOrganizerClassify(itemText);
  }
  if (!res || !res.ok) return fallbackOrganizerClassify(itemText);
  var j;
  try { j = await res.json(); } catch { return fallbackOrganizerClassify(itemText); }
  var content = typeof j.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content : "";
  return extractOrganizerJson(content, nameForTitle) || fallbackOrganizerClassify(itemText);

  } finally {
    inFlightOrganizerClassify -= 1;
  }
}
async function handleOrganizerTrial(req) {
  var body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  var kind = body.kind === "image" ? "image" : "text";
  var promo = body.promo === "on" || body.promo === "off" ? body.promo : "off";
  var text = typeof body.text === "string" ? body.text.trim() : "";
  var fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
  var dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  var description = typeof body.description === "string" ? body.description.trim() : "";
  if (kind === "text") {
    if (!text) return json3({ error: "Paste a message to file first." }, 400);
    if (text.length > 10000) return json3({ error: "That item is over 10,000 characters — try a shorter one." }, 400);
  } else {
    if (!dataUrl) return json3({ error: "Choose an image to upload first." }, 400);
    if (!ORGANIZER_DATAURL_RE.test(dataUrl)) return json3({ error: "We accept images and PDFs — please try again." }, 400);
    if (dataUrl.length > 3500000) return json3({ error: "That image is too large — try a smaller screenshot or bill." }, 400);
    if (description.length < 10) return json3({ error: "Add a line about what this is (at least a few words) so we can file it honestly." }, 400);
    if (description.length > 500) return json3({ error: "Keep the description under 500 characters." }, 400);
  }
  // Trial gate: signed in → keyed by account (survives cookie clears); anon →
  // keyed by bys_vid, minting the cookie server-side for cookie-less clients
  // (mirrors handleReview's anon branch).
  var session = getSession(req);
  var vid0 = visitorVid(req);
  var setVidCookie = null;
  var key, vid;
  if (session) {
    key = "user:" + session.userId;
  } else {
    vid = vid0 || crypto.randomUUID();
    if (!vid0) setVidCookie = "bys_vid=" + vid + "; Max-Age=31536000; Path=/; SameSite=Lax" + sharedDomainAttr(requestHost(req));
    key = "vid:" + vid;
  }
  // D4 (preflight 766ccd02): a count-read failure (lazy migration not yet
  // applied, Neon hiccup) degrades to 0 — the dad files rather than 500ing.
  var trialCount = 0;
  try {
    trialCount = await organizerTrialCount(key);
  } catch (err) {
    console.warn("[organizer] trial count read failed, treating as unused:", err);
  }
  if (trialCount >= ORGANIZER_TRIAL_LIMIT) {
    return json3({ error: ORGANIZER_TRIAL_402 }, 402, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
  }
  // Anonymous-only IP abuse cap (M2): a returning dad with a used vid cookie is
  // rejected above and never reaches the counter; signed-in trials skip it.
  if (!session) {
    var trialIpCount = await incrementOrganizerTrialIp(clientIp(req));
    if (trialIpCount > ORGANIZER_TRIAL_IP_DAILY_CAP) {
      return json3({ error: "You've used today's organizer demo. It resets tomorrow." }, 402, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
    }
  }
  var result = { folder: "other", category: "needs-sorting", reason: "Filed by rule — this looked like Other." };
  if (llm) {
    if (kind === "image") {
      result = await classifyOrganizerItem("[Image: " + (fileName || "upload") + "] Father's description: " + description, fileName);
    } else {
      result = await classifyOrganizerItem(text, text.split("\n")[0].slice(0, 40));
    }
  } else {
    result = fallbackOrganizerClassify(kind === "image" ? description : text);
  }
  var newCount = await markOrganizerTrial(key);
  var evVid = vid || visitorVid(req) || "server";
  var plan;
  if (session) {
    try {
      var usersForPlan = await readUsers();
      var uForPlan = usersForPlan.find(function (x) { return x.id === session.userId; });
      plan = uForPlan ? userTier(uForPlan) : undefined;
    } catch {}
  }
  addEvent({ vid: evVid, name: "organizer_trial_completed", plan, meta: { kind, folder: result.folder, promo, remaining: Math.max(0, ORGANIZER_TRIAL_LIMIT - newCount), count: newCount } }).catch(function (err) { console.warn("[organizer] trial event failed:", err); });
  return json3({ ok: true, result, trial: { used: newCount >= ORGANIZER_TRIAL_LIMIT, remaining: Math.max(0, ORGANIZER_TRIAL_LIMIT - newCount), count: newCount } }, 200, setVidCookie ? { "Set-Cookie": setVidCookie } : {});
}
// Paid organizer files (Command Center gate; UI ships next cycle — endpoints +
// table ship now so the next build has a place to put rows). Same CRUD shape
// as /api/log: own rows only.
// M2 (audit ac135af1): per-user/UTC-day silent cap on paid LLM classification.
// Generous — a dad files a handful of documents a day, 150 is far past any
// honest pace. Past the cap the item is still saved, just filed by the rule
// path (no 429, no error surface); the counter is increment-only (separate
// table) so a delete-and-reupload loop can never bypass it.
const ORGANIZER_CLASSIFY_DAY_CAP = 150;
async function handleOrganizerFiles(req, method, id) {
  var s = getSession(req);
  if (!s) return json3({ error: "The Document Organizer is part of the Command Center plan." }, 402);
  var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  var tier = userTier(u);
  var all = await readOrganizerFiles(u.id);
  // Sort My Pile buyers get the live Organizer for 30 days (sortUntil) — the
  // pack's included access. Command/Ultimate keep it permanently. Batch 1
  // (expiry trap): when the pack lapses but papers exist, the dad keeps
  // read/delete/rename — they're his rows, never held hostage; only NEW
  // uploads (POST) are gated with a calm 402 pointing at Command Center.
  if (!organizerEnabled(u)) {
    if (all.length === 0) return json3({ error: "The Document Organizer is part of the Command Center plan." }, 402);
    if (method === "POST") return json3({ error: "Your Sort My Pile access has ended — your papers are still here. You can keep viewing and deleting them. To file new papers, continue with the Command Center plan." }, 402);
  }
  if (method === "GET") return json3({ files: all });
  if (method === "DELETE") {
    await deleteOrganizerFile(u.id, id);
    return json3({ ok: true });
  }
  if (method === "PATCH") {
    var pb;
    try { pb = await req.json(); } catch { return json3({ error: "Invalid request." }, 400); }
    // Refile branch (FRONT A "wrong thing" feedback): the dad adds one line of
    // what the item is; we re-classify with his description as context (the
    // model can't see the image), persist the honest result + the description,
    // and return the updated row. Same classify path + daily cap as create.
    if (typeof pb.refile === "string") {
      var rf = pb.refile.trim();
      if (!rf) return json3({ error: "A line about what it is helps us file it — even a few words." }, 400);
      if (rf.length > 500) return json3({ error: "Keep it under 500 characters." }, 400);
      var existingFile = all.find(function (x) { return x.id === id; });
      if (!existingFile) return json3({ error: "That item wasn't found." }, 404);
      var refileText = "[File: " + (existingFile.title || "upload") + "] Father's description: " + rf;
      var refileOverCap = (await organizerClassifyCountToday(u.id)) >= ORGANIZER_CLASSIFY_DAY_CAP;
      var refileResult = llm && !refileOverCap ? await classifyOrganizerItem(refileText) : fallbackOrganizerClassify(refileText);
      if (llm && !refileOverCap) await incrementOrganizerClassify(u.id);
      var refiled = await updateOrganizerFile(u.id, id, {
        folder: refileResult.folder,
        category: refileResult.category,
        description: rf,
        reason: refileResult.reason,
        summary: refileResult.summary || null,
        tags: Array.isArray(refileResult.tags) ? refileResult.tags : null
      });
      if (!refiled) return json3({ error: "That item wasn't found." }, 404);
      addEvent({ vid: visitorVid(req) || "server", name: "organizer_refile", plan: tier, meta: { folder: refileResult.folder } }).catch(function (err) { console.warn("[organizer] refile event failed:", err); });
      return json3({ ok: true, file: refiled });
    }
    if (typeof pb.title === "string") {
      var t = pb.title.trim().slice(0, 200);
      if (!t) return json3({ error: "A name needs at least one character." }, 400);
      var renamed = await updateOrganizerFile(u.id, id, { title: t });
      if (!renamed) return json3({ error: "That item wasn't found." }, 404);
      return json3({ ok: true, file: renamed });
    }
    // Move an item to another folder (the classified result is a suggestion —
    // the dad decides where it lives). Validates against the taxonomy so a bad
    // payload can't write junk rows.
    var pf = folderBySlug(String(pb.folder || ""));
    if (!pf) return json3({ error: "That folder isn't one we recognize." }, 400);
    var pc = String(pb.category || pf.subfolders[0]?.slug || "needs-sorting");
    var okCat = pf.subfolders.some(function (s) { return s.slug === pc; });
    if (!okCat) return json3({ error: "That subfolder isn't one we recognize." }, 400);
    var moved = await updateOrganizerFile(u.id, id, { folder: pf.slug, category: pc });
    if (!moved) return json3({ error: "That item wasn't found." }, 404);
    return json3({ ok: true, file: moved });
  }
  var b;
  try {
    b = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  var kind = b.kind === "image" ? "image" : "text";
  var text = typeof b.text === "string" ? b.text.trim() : "";
  var dataUrl = typeof b.dataUrl === "string" ? b.dataUrl : "";
  var description = typeof b.description === "string" ? b.description.trim() : "";
  if (kind === "text") {
    if (!text) return json3({ error: "Message text is required." }, 400);
    if (text.length > 10000) return json3({ error: "That item is over 10,000 characters." }, 400);
  } else {
    if (!dataUrl) return json3({ error: "An image is required." }, 400);
    if (!ORGANIZER_DATAURL_RE.test(dataUrl)) return json3({ error: "We accept images and PDFs — please try again." }, 400);
    if (dataUrl.length > 3500000) return json3({ error: "That image is too large." }, 400);
    if (description.length > 500) return json3({ error: "Keep the description under 500 characters." }, 400);
  }
  // Per-user storage cap (L2): paid rows can each hold ~3.5M base64 chars, so
  // bound both row count and total base64 bytes to keep one account from
  // growing the shared DB without limit. 500 files / ~100 MB is generous.
  if (all.length >= 500) return json3({ error: "You've saved 500 documents — the Organizer's storage limit for now. Delete a few or email us and we'll help." }, 402);
  var existingBase64 = all.reduce(function (acc, f) { return acc + (typeof f.dataUrl === "string" ? f.dataUrl.length : 0); }, 0);
  if (existingBase64 + (kind === "image" ? dataUrl.length : 0) > 100 * 1024 * 1024) return json3({ error: "You've reached the Organizer's storage limit. Delete a few documents and you're set." }, 402);
  // The classifier can't see the file contents (text-only model) — it files by
  // the father's description, with the filename as context when there's no
  // description. Honest: the assigned folder is a suggestion, he decides.
  var fileLabel = kind === "image" && typeof b.title === "string" && b.title ? b.title.slice(0, 200) : "upload";
  var itemText2 = kind === "image" ? "[File: " + fileLabel + "] Father's description: " + (description || "no description") : text;
  var classifyOverCap = (await organizerClassifyCountToday(u.id)) >= ORGANIZER_CLASSIFY_DAY_CAP;
  var result2 = llm && !classifyOverCap ? await classifyOrganizerItem(itemText2) : fallbackOrganizerClassify(itemText2);
  if (llm && !classifyOverCap) await incrementOrganizerClassify(u.id);
  var row = {
    id: crypto.randomUUID(),
    userId: u.id,
    kind,
    title: kind === "image" && typeof b.title === "string" ? b.title.slice(0, 200) : null,
    content: kind === "text" ? text : null,
    dataUrl: kind === "image" ? dataUrl : null,
    description: kind === "image" ? description : null,
    folder: result2.folder,
    category: result2.category,
    reason: result2.reason,
    summary: result2.summary || null,
    tags: Array.isArray(result2.tags) ? result2.tags : null,
    trial: false,
    createdAt: new Date().toISOString()
  };
  await addOrganizerFile(row);
  addEvent({ vid: visitorVid(req) || "server", name: "organizer_classify", plan: tier, meta: { kind, folder: result2.folder } }).catch(function (err) { console.warn("[organizer] classify event failed:", err); });
  return json3({ ok: true, file: row }, 201);
}
// ---- Sort My Pile (one-time pack, $19.50) --------------------------------
// A dad with a pile of unorganized papers pays once; the app sorts up to 50
// documents into his REAL Organizer folders. REAL CONTENT SORT (owner
// 2026-08-11): the client reads the paper's OWN text on-device (PDF/Word/.txt,
// page by page) and sends up to 10k chars per paper; the server classifies each
// from its full text via the LLM (bounded-parallel pool of 4, shared 150/day
// classify cap, deterministic fallback). Photos and scanned papers have no
// readable text — they take the honest rule path (file name + dad's line) and
// land in "needs sorting" when nothing maps. File bytes never leave the device.
// The sort is SYNCHRONOUS: <=50 items with a 4-wide LLM pool completes inside
// the 60s serverless budget, so the POST handler files everything and returns
// the full result set in one response. There is no background job
// and no in-memory job map (those froze on Vercel serverless: the instance was
// frozen after the response and polls hit an empty map, so zero files were
// written — P1 fix 2026-08-12). The client reveals results locally at a calm
// cadence instead of polling. The last sort result is stashed on the user's
// profile so the legacy GET /api/organizer/sort/:jobId compat endpoint can
// still return a completed job's results to a stale client that polls.
const SORT_PILE_MAX_ITEMS = 50;
const SORT_PILE_MAX_NAME = 120;
const SORT_PILE_MAX_DESC = 500;
const ORGANIZER_DOC_CAP = 500; // matches the Organizer upload gate
function sortItemTitle(name) {
  const out = String(name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return (out || "Paper").slice(0, 200);
}
// Runs the full sort inline. Deterministic, no LLM, <=50 items — fast enough
// that everything completes inside the POST request. Writes each filed item
// straight into the real Organizer rows and returns the result contract the
// client renders: { status:"done", results, filed, needsSorting, skipped }.
async function runSortPileSync(u, items, pileLabel, vid, tier, jobId) {
  const existing = await readOrganizerFiles(u.id).catch(() => []);
  const existingCount = Array.isArray(existing) ? existing.length : 0;
  const room = Math.max(0, ORGANIZER_DOC_CAP - existingCount);
  const label = function (slug) { return (folderBySlug(slug) || { label: slug }).label; };
  // Shared 150/day LLM-classify budget (same counter the Organizer uses): past
  // the cap, text papers file by the rule path instead — silent, honest, no 429.
  let usedToday = 0;
  try { usedToday = await organizerClassifyCountToday(u.id); } catch (err) { console.warn("[sortpile] classify count read failed:", err); }
  let classifyBudget = Math.max(0, ORGANIZER_CLASSIFY_DAY_CAP - (Number.isFinite(usedToday) ? usedToday : 0));
  // Phase 1 — plan the work, keeping strict item order for the results.
  const byIndex = new Map(); // i -> {kind:"skip"|"rule"|"llm", item, docText}
  let skippedCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Real cap (honesty rail): stop filing at the 500-doc limit and REPORT the
    // rest — no item is ever dropped or mislabeled as sorted.
    if (i >= room) { byIndex.set(i, { kind: "skip", item }); skippedCount++; continue; }
    const docText = typeof item.text === "string" ? item.text : "";
    byIndex.set(i, { kind: docText.trim().length > 0 ? "llm" : "rule", item, docText });
  }
  const results = []; // {i, row} — sorted back to item order at the end
  let filedCount = 0, needsSortCount = 0;
  // File a rule-path item (photo/scan or text when the LLM budget is gone).
  // Name + description first (the honest signal). The pile label is a
  // LAST-RESORT hint: only when name+description don't map does the label
  // decide ("court" pile with an unlabeled photo -> Legal). It can never
  // override a clear signal.
  async function fileRuleItem(w) {
    const hasText = w.docText.trim().length > 0;
    const ruleText = [w.item.name, w.item.description].filter(Boolean).join(" ");
    let hit = ruleFolderFor(ruleText);
    if (!hit && pileLabel) hit = ruleFolderFor(pileLabel);
    if (!hit) {
      // Honest fallback: filed under Needs sorting so it's never lost; the dad
      // can add one line and refile from the Organizer (existing PATCH refile).
      // A text item that lands here keeps its extracted text (budget exhausted
      // or provider down) so the drawer still shows the paper.
      const row = {
        id: crypto.randomUUID(), userId: u.id, kind: "text",
        title: null, content: hasText ? w.docText.slice(0, 5000) : (w.item.description || w.item.name), dataUrl: null,
        description: w.item.description || null,
        folder: "other", category: "needs-sorting",
        reason: "Needs sorting — we couldn't tell where this one goes.",
        summary: "Needs sorting — we couldn't tell where this one goes from the file name or your description.",
        tags: ["other", "needs-sorting"],
        trial: false, createdAt: new Date().toISOString()
      };
      await addOrganizerFile(row);
      results.push({ i: w.i, row: { name: w.item.name, folder: "other", category: "needs-sorting", title: sortItemTitle(w.item.name), summary: row.summary, needsSorting: true, filed: true, reason: row.reason } });
      needsSortCount++;
      return;
    }
    const row = {
      id: crypto.randomUUID(), userId: u.id, kind: "text",
      title: null, content: hasText ? w.docText.slice(0, 5000) : (w.item.description || w.item.name), dataUrl: null,
      description: w.item.description || null,
      folder: hit.folder, category: hit.category,
      reason: "Filed by rule — this looked like " + label(hit.folder) + ".",
      summary: w.item.description ? w.item.description.slice(0, 300) : "Filed by rule under " + label(hit.folder) + " — from your Sort My Pile batch.",
      tags: [hit.folder, hit.category, "needs-check"],
      trial: false, createdAt: new Date().toISOString()
    };
    await addOrganizerFile(row);
    results.push({ i: w.i, row: { name: w.item.name, folder: hit.folder, category: hit.category, title: sortItemTitle(w.item.name), summary: row.summary, needsSorting: false, filed: true, reason: row.reason } });
    filedCount++;
  }
  // File an LLM-classified item (its own extracted text drove the folder; the
  // text is stored <=5k so the Organizer drawer shows the paper).
  async function fileLlmItem(w, cls) {
    const needs = cls.folder === "other" && cls.category === "needs-sorting";
    const row = {
      id: crypto.randomUUID(), userId: u.id, kind: "text",
      title: cls.title || sortItemTitle(w.item.name),
      content: w.docText.slice(0, 5000), dataUrl: null,
      description: w.item.description || null,
      folder: cls.folder, category: cls.category,
      reason: cls.reason, summary: cls.summary, tags: cls.tags,
      trial: false, createdAt: new Date().toISOString(),
      extractedAt: new Date().toISOString()
    };
    await addOrganizerFile(row);
    results.push({ i: w.i, row: { name: w.item.name, folder: cls.folder, category: cls.category, title: row.title, summary: row.summary, needsSorting: needs, filed: true, reason: row.reason } });
    if (needs) needsSortCount++;
    else {
      filedCount++;
      addEvent({ vid: vid || "server", name: "sortpile_content_filed", plan: tier, meta: { folder: cls.folder } }).catch(function (err) { console.warn("[sortpile] content event failed:", err); });
    }
  }
  // Phase 2a — file skip + rule items immediately (fast, no LLM). A later
  // timeout still leaves these safely in the Organizer.
  for (let i = 0; i < items.length; i++) {
    const w = byIndex.get(i);
    if (w.kind === "skip") {
      results.push({ i, row: { name: w.item.name, folder: null, category: null, title: sortItemTitle(w.item.name), summary: null, needsSorting: false, filed: false, skipped: "cap" } });
      continue;
    }
    if (w.kind === "rule") await fileRuleItem(w);
  }
  // Phase 2b — classify papers WITH extracted text from their own content in a
  // bounded-parallel pool of 4 (matching the Organizer's in-flight guard, so
  // the pool never trips it), and FILE EACH CHUNK before the next classify
  // wave: a 60s serverless timeout mid-pile leaves completed chunks filed, so
  // the calm 502 line ("Any that filed are safe") stays honest. The LLM never
  // throws (fallback classifier) — a slow/erroring provider degrades to the
  // rule path, never a hung sort.
  const SORT_LLM_CONCURRENCY = 4;
  const llmWork = [...byIndex.entries()]
    .filter(function (e) { return e[1].kind === "llm"; })
    .map(function (e) { return { i: e[0], item: e[1].item, docText: e[1].docText }; });
  for (let start = 0; start < llmWork.length; start += SORT_LLM_CONCURRENCY) {
    const chunk = llmWork.slice(start, start + SORT_LLM_CONCURRENCY);
    const outcomes = await Promise.all(chunk.map(async function (w) {
      if (classifyBudget <= 0 || !llm) return { i: w.i, cls: null };
      classifyBudget--;
      const itemText = [w.item.name, w.item.description].filter(Boolean).join(" — ") + "\n\nThe document text:\n" + w.docText;
      // Trim LLM input to 8k (well past any single document's useful signal)
      // so a 10k text cap never blows the model's context or the 30s deadline.
      const cls = await classifyOrganizerItem(itemText.slice(0, 8000), w.item.name, ORGANIZER_SORT_SYSTEM_PROMPT);
      await incrementOrganizerClassify(u.id).catch(function (err) { console.warn("[sortpile] classify count failed:", err); });
      return { i: w.i, cls };
    }));
    for (const o of outcomes) {
      const w = byIndex.get(o.i);
      await (o.cls ? fileLlmItem(w, o.cls) : fileRuleItem(w));
    }
  }
  // Phase 3 — results in strict original item order (the client renders rows
  // in array order and walks them one by one).
  results.sort(function (a, b) { return a.i - b.i; });
  const outRows = results.map(function (r) { return r.row; });
  const out = {
    status: "done", jobId, results: outRows,
    filed: filedCount, needsSorting: needsSortCount, skipped: skippedCount,
    total: items.length
  };
  // Remember the result so the legacy poll endpoint can return it (profile
  // JSONB — one small UPDATE; a failure here must never fail the sort).
  await updateUserProfile(u.id, { lastSort: { jobId, at: new Date().toISOString(), status: "done", results: outRows, filed: filedCount, needsSorting: needsSortCount, skipped: skippedCount, total: items.length } }).catch(function (err) { console.warn("[sortpile] lastSort save failed:", err); });
  addEvent({ vid: vid || "server", name: "sortpile_job_done", plan: tier, meta: { filed: filedCount, needsSorting: needsSortCount, skipped: skippedCount, total: items.length } }).catch(function (err) { console.warn("[sortpile] done event failed:", err); });
  return out;
}

async function handleSortPileCreate(req) {
  const s = getSession(req);
  if (!s) return json3({ error: "Sign in to use Sort My Pile." }, 401);
  let users;
  try { users = await readUsers(); } catch (err) { console.warn("[sortpile] users read failed:", err); return json3({ error: "We couldn't start that right now — try again in a moment." }, 500); }
  const u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  const tier = userTier(u);
  if (tier !== "command" && tier !== "ultimate" && !sortPileActive(u))
    return json3({ error: "Sort My Pile is a one-time purchase — $19.50. It sorts up to 50 papers into your folders." }, 402);
  let body;
  try { body = await req.json(); } catch { return json3({ error: "Invalid request." }, 400); }
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) return json3({ error: "Choose at least one paper to sort." }, 400);
  if (rawItems.length > SORT_PILE_MAX_ITEMS) return json3({ error: "Sort My Pile handles up to 50 papers at a time." }, 400);
  const pileLabel = typeof body?.pileLabel === "string" ? body.pileLabel.trim().slice(0, 40) : "";
  const items = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") return json3({ error: "One of the papers is missing its file name." }, 400);
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name) return json3({ error: "One of the papers is missing its file name." }, 400);
    if (name.length > SORT_PILE_MAX_NAME) return json3({ error: "Keep each file name under 120 characters." }, 400);
    const description = typeof it.description === "string" ? it.description.trim().slice(0, SORT_PILE_MAX_DESC) : "";
    // Optional extracted text (whole-document sort): the client reads PDFs/Word/
    // .txt on-device and sends up to 10k chars of the paper's own text. Items
    // without text keep the honest rule path (photos/scans). Normalize line
    // endings so Windows/classic-Mac files don't fragment the text mid-word.
    const text = typeof it.text === "string" ? it.text.replace(/\r\n?/g, "\n").trim() : "";
    if (text.length > 10000) return json3({ error: "That paper's text is too long — 10,000 characters max." }, 400);
    items.push({ name, description, text });
  }
  // Full sort runs in-request: papers with extracted text are classified by the
  // LLM in a bounded-parallel pool (4 in flight, shared 150/day cap); papers
  // without text use the deterministic rule path. Files are written before the
  // response returns; a failure mid-write degrades to a calm 502, never a hung
  // poll.
  try {
    const out = await runSortPileSync(u, items, pileLabel, visitorVid(req) || "server", tier, crypto.randomUUID());
    return json3(out);
  } catch (err) {
    console.error("[sortpile] sync sort failed:", err);
    return json3({ error: "We hit a snag while filing your papers — try again in a moment. Any that filed are safe in your Organizer." }, 502);
  }
}
// Legacy compat endpoint: the current client renders results directly from the
// POST response and never polls. A stale cached client that polls gets the
// completed job's results when it matches the last sort on the account, or the
// calm vanished-job line otherwise — never a hung or broken state.
async function handleSortPilePoll(req, jobId) {
  const s = getSession(req);
  if (!s) return json3({ error: "Sign in required." }, 401);
  let users;
  try { users = await readUsers(); } catch (err) { console.warn("[sortpile] users read failed:", err); return json3({ error: "We couldn't check that right now — try again in a moment." }, 500); }
  const u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  const last = u?.profile?.lastSort;
  if (last && last.status === "done" && last.jobId === jobId)
    return json3({ status: "done", done: last.total, total: last.total, results: last.results, filed: last.filed, needsSorting: last.needsSorting, skipped: last.skipped });
  return json3({ status: "failed", done: 0, total: 0, error: "That sorting job is no longer available — start a new one and it'll be right here." });
}
// ---- Export pack (Command Center paid feature) ------------------------------
// A calm, complete copy of the dad's OWN record — saved reviews, Communication
// Log, Event Timeline, Organizer documents (titles/summaries/tags/text — never
// the image binaries), and his Case Summary when one exists. Rendered
// server-side as a single self-contained HTML file (zero deps, opens on any
// phone, prints cleanly) and returned as an attachment. Honest framing only:
// it's his record, organized for him — no legal/admissibility claims.
var EXPORT_402 = "The Export pack is part of the Command Center plan.";
// Export assembly moved to src/lib/exportPack.ts (2026-08-12): expDate/expEsc/
// expBlocksHtml + all section HTML are shared with the Attorney Prep Pack so
// both downloads render the identical full-record sections.
async function handleExport(req) {
  var s = getSession(req);
  if (!s) return json3({ error: EXPORT_402 }, 402);
  var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  var tier = userTier(u);
  // Batch 1 (Sort My Pile expiry trap): a lapsed Sort My Pile buyer keeps
  // export access while their papers exist — their own record is never held
  // hostage. A files-meta read failure degrades to the plain gate (402).
  if (tier !== "command" && tier !== "ultimate") {
    var files0 = [];
    try { files0 = await readOrganizerFilesMeta(u.id); } catch (err) { console.warn("[export] files meta read failed:", err); }
    if (files0.length === 0) return json3({ error: EXPORT_402 }, 402);
  }
  // Gather ONLY the dad's own rows via user-scoped reads (M2 audit de2c7f92) —
  // never full-table scans filtered in memory, and never email-keyed merges
  // (landing-capture drafts were adopted into his own reviews at account
  // creation, M3). A failed gather must degrade to a calm 502, never a 500.
  var reviews, log, timeline, files, cs;
  try {
    reviews = (await readReviewsForUser(u.id)).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    log = await readLogForUser(u.id);
    timeline = await readTimelineForUser(u.id);
    files = await readOrganizerFilesMeta(u.id);
    cs = await readCaseSummary(u.id);
  } catch (err) {
    console.warn("[export] record gather failed:", err);
    return json3({ error: "We couldn't prepare your record right now — give it a minute and try again." }, 502);
  }
  var generatedAt = expDate(new Date().toISOString());
  var html = "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>Your Record — Before You Send</title><style>" + exportPackCss() + "</style></head><body><div class=\"wrap\"><header><h1>Your Record — Before You Send</h1><p class=\"sub\">Exported " + expEsc(generatedAt) + ". Everything you've saved — saved reviews, communication log, event timeline, organizer documents, and your case summary — in one file.</p><p class=\"sub\">This is your own record from Before You Send. It is not legal advice.</p></header>";
  html += buildExportSectionsHtml(reviews, log, timeline, files, cs, generatedAt);
  html += "</div></body></html>";
  var fname = "Before-You-Send-Record-" + new Date().toISOString().slice(0, 10) + ".html";
  return new Response(html, { status: 200, headers: toHeaders({ "Content-Type": "text/html; charset=utf-8", "Content-Disposition": 'attachment; filename="' + fname + '"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }) });
}
// ---- Attorney Prep Pack (one-time $24.50) ------------------------------
// Stage 2 DELIVERABLE (2026-08-12): generates the self-contained HTML pack
// from the dad's OWN record — cover sheet, case chronology, evidence/document
// index, communication-pattern summary, and the full record bundle. The
// entitlement is the Stage-1 grant (Ultimate OR a durable profile.attorneyPrep
// stamp) — the same server-side authority the pricing card and dashboard read;
// re-download = regenerate on demand (no HTML blobs persisted). Deterministic
// first: the LLM only polishes the narrative paragraph; on any provider
// failure the pack still assembles completely from the record. The honest
// footer "Prepared from your record — communication guidance, not legal advice."
// is baked into the HTML; this route never implies attorney review.
var ATTORNEY_PREP_402 = "The Attorney Prep Pack is a one-time purchase — you can get it from the One-time tab on the pricing page.";
async function handleAttorneyPack(req) {
  var s = getSession(req);
  if (!s) return json3({ error: ATTORNEY_PREP_402 }, 402);
  var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  if (!attorneyPrepEntitled(u)) return json3({ error: ATTORNEY_PREP_402 }, 402);
  var reviews, log, timeline, files, cs;
  try {
    reviews = (await readReviewsForUser(u.id)).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    log = await readLogForUser(u.id);
    timeline = await readTimelineForUser(u.id);
    files = await readOrganizerFilesMeta(u.id);
    cs = await readCaseSummary(u.id);
  } catch (err) {
    console.warn("[attorney-pack] record gather failed:", err);
    return json3({ error: "We couldn't prepare your pack right now — give it a minute and try again." }, 502);
  }
  var pack;
  try {
    pack = await buildAttorneyPack({ user: u, reviews: reviews, log: log, timeline: timeline, files: files, caseSummary: cs }, llm);
  } catch (err) {
    console.warn("[attorney-pack] assembly failed:", err);
    return json3({ error: "We couldn't prepare your pack right now — please try again." }, 502);
  }
  addEvent({ vid: visitorVid(req) || "server", name: "attorney_pack_generate", plan: userTier(u), meta: { fallback: pack.fallback } }).catch(function (err) { console.warn("[attorney-pack] event failed:", err); });
  return new Response(pack.html, { status: 200, headers: toHeaders({ "Content-Type": "text/html; charset=utf-8", "Content-Disposition": 'attachment; filename="' + pack.filename + '"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }) });
}

// ---- Case Summary (Command Center paid feature) -----------------------------
// A calm, factual overview of the dad's OWN saved record (Communication Log,
// Event Timeline, Organizer documents with summaries/tags, saved reviews).
// Generated on demand (POST /api/case-summary), persisted per user, and only
// regenerated when he taps the button — never on view (keeps LLM volume modest
// and the page honest about which version of his data it reflects).
var CASE_SUMMARY_402 = "The Case Summary is part of the Command Center plan.";
var CASE_MAX_EXCERPT_CHARS = 30000;
function csTruncate(s, n) {
  var t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
function csDay(d) {
  var dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d == null ? "" : d) : dt.toISOString().slice(0, 10);
}
// Gather + bound the dad's own data into one excerpt. Documents contribute
// folder/summary/tags ONLY (never file contents); log/timeline/review text is
// truncated. Tallies feed the deterministic fallback; version fingerprints the
// exact data set so the page can show whether a stored summary is current.
async function gatherCaseData(u) {
  var [logsAll, timelineAll, files, reviewsAll] = await Promise.all([
    readLog(), readTimeline(), readOrganizerFiles(u.id), readReviews()
  ]);
  var ownLogs = logsAll.filter(function (x) { return x.userId === u.id; });
  var ownTimeline = timelineAll.filter(function (x) { return x.userId === u.id; });
  var ownReviews = reviewsAll.filter(function (x) { return x.userId === u.id; });
  var logs = ownLogs.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 50);
  var timeline = ownTimeline.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 30);
  var docs = files.slice(0, 40);
  var reviews = ownReviews.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 15);
  var counts = { log: ownLogs.length, timeline: ownTimeline.length, docs: files.length, reviews: ownReviews.length };
  var parts = [];
  parts.push("COMMUNICATION LOG (" + counts.log + " total, showing the " + logs.length + " most recent):");
  if (!logs.length) parts.push("(none)");
  logs.forEach(function (l) {
    parts.push("- [" + (l.date ? csDay(l.date) : "no date") + "] " + (l.direction === "received" ? "received from co-parent" : "sent by me") + ", topic: " + (l.topic || "other") + " — " + csTruncate(l.message, 240));
  });
  parts.push("EVENT TIMELINE (" + counts.timeline + " total, showing the " + timeline.length + " most recent):");
  if (!timeline.length) parts.push("(none)");
  timeline.forEach(function (t) {
    parts.push("- [" + (t.date || "no date") + "] " + (t.category || "other") + " — " + csTruncate(t.title, 160) + (t.details ? ": " + csTruncate(t.details, 240) : ""));
  });
  parts.push("DOCUMENT ORGANIZER (" + counts.docs + " total, showing the " + docs.length + " most recent):");
  if (!docs.length) parts.push("(none)");
  docs.forEach(function (d) {
    var label = d.title || d.summary || d.description || "document";
    parts.push("- folder: " + (d.folder || "other") + "/" + (d.category || "") + " — " + csTruncate(label, 120) + (d.summary ? " — " + csTruncate(d.summary, 200) : "") + (d.tags && d.tags.length ? " — tags: " + d.tags.slice(0, 5).join(", ") : ""));
  });
  parts.push("SAVED MESSAGE REVIEWS (" + counts.reviews + " total, showing the " + reviews.length + " most recent):");
  if (!reviews.length) parts.push("(none)");
  reviews.forEach(function (r) {
    parts.push("- draft: " + csTruncate(r.draft, 200) + (r.review ? " — review excerpt: " + csTruncate(r.review, 400) : ""));
  });
  var excerpt = parts.join("\n").slice(0, CASE_MAX_EXCERPT_CHARS);
  var folderTally = {};
  files.forEach(function (f) { folderTally[f.folder || "other"] = (folderTally[f.folder || "other"] || 0) + 1; });
  var topicTally = {};
  ownLogs.forEach(function (l) { topicTally[l.topic || "other"] = (topicTally[l.topic || "other"] || 0) + 1; });
  var categoryTally = {};
  ownTimeline.forEach(function (t) { categoryTally[t.category || "other"] = (categoryTally[t.category || "other"] || 0) + 1; });
  var version = counts.log + "|" + counts.timeline + "|" + counts.docs + "|" + counts.reviews + "|" + crypto.createHash("sha256").update(excerpt).digest("hex").slice(0, 10);
  return { excerpt: excerpt, counts: counts, version: version, total: counts.log + counts.timeline + counts.docs + counts.reviews, folderTally: folderTally, topicTally: topicTally, categoryTally: categoryTally };
}
var CASE_SYSTEM_PROMPT = `You are "Before You Send", a calm, practical organizing assistant for a father in a co-parenting or custody situation. The father has saved his own records: a Communication Log (messages he sent and received with the co-parent), an Event Timeline (important moments), a Document Organizer (documents with folder, summary and tags), and saved message reviews.

Below is a bounded excerpt of HIS OWN saved data. Write a calm, factual Case Summary that organizes what his saved record shows right now. Use EXACTLY these four sections (plain text, "### " headers, nothing before the first header):

### DATES & TIMELINE
What dates and date ranges actually appear in the record — e.g. "Records span August 2026 through October 2026; the most recent entry is October 12, 2026." For any source that has nothing, say so honestly ("No timeline events saved yet." / "No log entries saved yet.").

### KEY PEOPLE
Only people who actually appear in the excerpt: the co-parent, children, school, doctors, attorneys. If none are named, say "No people mentioned in the saved records yet."

### KEY DOCUMENTS
2-4 short bullets about the documents in the Organizer, drawn from their folders, summaries, and tags. If there are no documents, say "No documents saved yet."

### RECURRING TOPICS & PATTERNS
2-4 short bullets on patterns that are actually visible in the excerpt — schedule disputes, communication tone, expenses, school or health matters. Ground each observation in the data, e.g. "Several log entries are about pickup and drop-off times." If the record is too thin, say "Not enough saved records to identify patterns yet."

RULES:
- Reference ONLY facts actually present in the excerpt. Never invent names, dates, events, documents, or patterns.
- NEVER give legal advice, never predict outcomes, never say what a judge or attorney would do or think.
- Stay calm, neutral, and brief — under 350 words total. This is an organizing summary of his own record, not advocacy.

Father's saved records:
`;
// Deterministic fallback — the Case Summary never hard-fails. Built from the
// same counts/tallies that feed the excerpt, with honest "quick mode" wording.
function fallbackCaseSummary(d) {
  var lines = [];
  lines.push("### DATES & TIMELINE");
  var when = [];
  if (d.counts.log) when.push(d.counts.log + (d.counts.log === 1 ? " log entry" : " log entries"));
  if (d.counts.timeline) when.push(d.counts.timeline + (d.counts.timeline === 1 ? " timeline event" : " timeline events"));
  if (d.counts.docs) when.push(d.counts.docs + (d.counts.docs === 1 ? " document" : " documents"));
  if (d.counts.reviews) when.push(d.counts.reviews + (d.counts.reviews === 1 ? " saved review" : " saved reviews"));
  lines.push(when.length
    ? "Your saved record currently holds " + when.join(", ") + ". The summary engine is briefly busy, so this is a quick version — tap Regenerate in a minute for the full read."
    : "Nothing saved yet — add log entries, timeline events, or documents and the summary will build from them.");
  lines.push("### KEY PEOPLE");
  lines.push("Names aren't listed in this quick version — regenerate to get the people from your record.");
  lines.push("### KEY DOCUMENTS");
  var folderNames = Object.keys(d.folderTally).sort();
  if (!folderNames.length) {
    lines.push("No documents saved yet.");
  } else {
    lines.push(folderNames.map(function (f) { return "• " + f + ": " + d.folderTally[f]; }).join(" "));
  }
  lines.push("### RECURRING TOPICS & PATTERNS");
  var topics = Object.keys(d.topicTally).sort();
  var cats = Object.keys(d.categoryTally).sort();
  if (!topics.length && !cats.length) {
    lines.push("Not enough saved records to identify patterns yet.");
  } else {
    if (topics.length) lines.push("• Most common log topics: " + topics.map(function (t) { return t + " (" + d.topicTally[t] + ")"; }).join(", ") + ".");
    if (cats.length) lines.push("• Timeline categories: " + cats.map(function (c) { return c + " (" + d.categoryTally[c] + ")"; }).join(", ") + ".");
  }
  return lines.join("\n");
}
async function generateCaseSummary(u) {
  var d = await gatherCaseData(u);
  if (d.total === 0) return { empty: true, data: d, text: null, usedFallback: false };
  var text = null, usedFallback = false;
  if (llm) {
    try {
      var res = await fetch(llm.base + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + llm.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llm.model,
          stream: false,
          temperature: 0.2,
          max_tokens: 800,
          messages: [
            { role: "system", content: CASE_SYSTEM_PROMPT },
            { role: "user", content: d.excerpt }
          ]
        }),
        signal: AbortSignal.timeout(45000)
      });
      if (res.ok) {
        var j = await res.json().catch(function () { return null; });
        var content = typeof j?.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content.trim() : "";
        if (content) text = content.slice(0, 8000);
      }
    } catch (err) { /* fall through to the deterministic fallback */ }
  }
  if (!text) { text = fallbackCaseSummary(d); usedFallback = true; }
  return { empty: false, data: d, text: text, usedFallback: usedFallback };
}
async function handleCaseSummary(req, method) {
  var s = getSession(req);
  if (!s) return json3({ error: CASE_SUMMARY_402 }, 402);
  var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  var tier = userTier(u);
  if (tier !== "command" && tier !== "ultimate") return json3({ error: CASE_SUMMARY_402 }, 402);
  if (method === "GET") {
    var stored = await readCaseSummary(u.id);
    var data = await gatherCaseData(u);
    return json3({ summary: stored ? { text: stored.text, generatedAt: stored.generatedAt, dataVersion: stored.dataVersion } : null, counts: data.counts });
  }
  var gen = await generateCaseSummary(u);
  if (gen.empty) {
    addEvent({ vid: visitorVid(req) || "server", name: "case_summary_generate", plan: tier, meta: { empty: true } }).catch(function (err) { console.warn("[case-summary] event failed:", err); });
    return json3({ ok: true, empty: true, summary: null, counts: gen.data.counts });
  }
  await writeCaseSummary(u.id, gen.text, gen.data.version);
  addEvent({ vid: visitorVid(req) || "server", name: "case_summary_generate", plan: tier, meta: { fallback: gen.usedFallback } }).catch(function (err) { console.warn("[case-summary] event failed:", err); });
  return json3({ ok: true, summary: { text: gen.text, generatedAt: new Date().toISOString(), dataVersion: gen.data.version }, counts: gen.data.counts, fallback: gen.usedFallback });
}

// ---- Action Center (Command Center paid feature) -----------------------------
// One calm page: "what needs your attention" built from the father's OWN saved
// records. Four sections (Unresolved / Upcoming / Missing / Needs
// documentation), each item = short sentence + source + suggested next action
// (a REAL tab deep-link where feasible, honest copy otherwise). Generated via
// the same DeepSeek-V3.2 SambaNova pattern as the Case Summary, with a fully
// deterministic rule-based fallback (dates → upcoming, keyword flags →
// unresolved / needs-documentation, doc-folder gaps → missing) so the page
// ALWAYS works. Persisted per user (bys_action_center, created in the storage
// init batch — never lazy-DDL-only) so it doesn't regenerate every visit; a
// Regenerate button refreshes it. Organizing aid, not legal advice.
var ACTION_CENTER_402 = "The Action Center is part of the Command Center plan.";
var AC_MAX_EXCERPT_CHARS = 26000;
var AC_SECTIONS = ["unresolved", "upcoming", "missing", "needs_documentation"];
var AC_HEADERS = { "### UNRESOLVED": "unresolved", "### UPCOMING": "upcoming", "### MISSING": "missing", "### NEEDS DOCUMENTATION": "needs_documentation" };
var AC_ACTION_TABS = { timeline: 1, log: 1, organizer: 1, tools: 1 };
function acTruncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
// Parse "YYYY-MM-DD" (timeline/log dates). Returns a Date at local midnight or null.
function acParseDay(d) {
  if (typeof d !== "string") return null;
  var m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  var dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(dt.getTime()) ? null : dt;
}
function acDayLabel(d) {
  var dt = acParseDay(d);
  if (!dt) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Loose date parse for the Case Summary text: "Month D, YYYY" or "Month D".
var AC_MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
function acParseTextDate(s) {
  var m = String(s).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/i);
  if (!m) return null;
  var mon = AC_MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return null;
  var day = Number(m[2]);
  if (day < 1 || day > 31) return null;
  var year = m[3] ? Number(m[3]) : new Date().getFullYear();
  var dt = new Date(year, mon, day);
  return isNaN(dt.getTime()) ? null : dt;
}
function acDaysFromNow(dt) {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dt.getTime() - start.getTime()) / 86400000);
}
function acSourceDate(d) {
  var dt = acParseDay(d);
  if (dt) return " \u00b7 " + dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return "";
}
function acItem(section, text, source, action, actionType, ref) {
  return {
    id: crypto.randomUUID(),
    section: section,
    text: acTruncate(text, 300),
    source: acTruncate(source, 120),
    action: acTruncate(action, 80),
    actionType: actionType === "tab" ? "tab" : "copy",
    ref: AC_ACTION_TABS[ref] ? ref : undefined
  };
}
// Deterministic fallback — the Action Center never hard-fails. Built purely
// from the father's own saved data with honest "quick mode" wording.
function fallbackActionItems(d) {
  var items = [];
  var today = new Date();
  var startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // UPCOMING — dates in the timeline and log that are today..+90 days.
  var seen = {};
  (d.timeline || []).forEach(function (t) {
    var dt = acParseDay(t.date);
    if (!dt) return;
    var days = acDaysFromNow(dt);
    if (days < 0 || days > 90) return;
    var label = acDayLabel(t.date);
    if (seen["tl" + label + (t.title || "")]) return;
    seen["tl" + label + (t.title || "")] = 1;
    items.push(acItem("upcoming",
      (t.title ? acTruncate(t.title, 90) : "A dated event") + " is on your timeline for " + label + ".",
      "Event Timeline" + acSourceDate(t.date),
      "Already on your timeline \u2014 nothing to do", "copy", ""));
  });
  (d.logs || []).slice(0, 200).forEach(function (l) {
    var dt = acParseDay(l.date);
    if (!dt) return;
    var days = acDaysFromNow(dt);
    if (days < 0 || days > 90) return;
    var label = acDayLabel(l.date);
    var key = "log" + label + (l.message || "").slice(0, 40);
    if (seen[key]) return;
    seen[key] = 1;
    items.push(acItem("upcoming",
      "A message dated " + label + " has a date coming up \u2014 \u201c" + acTruncate(l.message, 90) + "\u201d.",
      "Communication Log" + acSourceDate(l.date),
      "Add to timeline", "tab", "timeline"));
  });
  // Case Summary text can name dates too (e.g. "December 15, 2026").
  if (d.caseSummaryText) {
    var m2 = String(d.caseSummaryText).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/gi);
    if (m2) {
      var seenCs = {};
      m2.slice(0, 6).forEach(function (raw) {
        var dt = acParseTextDate(raw);
        if (!dt) return;
        var days = acDaysFromNow(dt);
        if (days < 0 || days > 90) return;
        var label = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        if (seenCs[label]) return;
        seenCs[label] = 1;
        items.push(acItem("upcoming",
          "Your Case Summary mentions " + label + " \u2014 worth keeping in mind.",
          "Case Summary",
          "Note the date", "copy", ""));
      });
    }
  }
  // UNRESOLVED — repeated topics + conflict-flavored exchanges (last 30 days).
  var cutoff = new Date(startOfToday.getTime() - 30 * 86400000);
  var recent = (d.logs || []).filter(function (l) {
    var dt = acParseDay(l.date) || new Date(l.date || 0);
    return !isNaN(dt.getTime()) && dt.getTime() >= cutoff.getTime();
  });
  var topicTally = {};
  recent.forEach(function (l) { var t = l.topic || "other"; topicTally[t] = (topicTally[t] || 0) + 1; });
  var conflictRe = /refus|denied|won'?t|never|always|threat|emergency|ignore|ignored|harass|lawyer|attorney|court|false|lie|lying/i;
  var conflictSeen = {};
  recent.forEach(function (l) {
    if (!conflictRe.test(l.message || "")) return;
    var key = (l.topic || "other") + "|" + (l.message || "").slice(0, 30);
    if (conflictSeen[key] || conflictSeen.count >= 3) return;
    conflictSeen[key] = 1;
    conflictSeen.count = (conflictSeen.count || 0) + 1;
    items.push(acItem("unresolved",
      "A recent " + (l.topic || "communication") + " exchange reads as tense \u2014 \u201c" + acTruncate(l.message, 80) + "\u201d. Worth logging while it's fresh.",
      "Communication Log" + acSourceDate(l.date),
      "Add to timeline", "tab", "timeline"));
  });
  Object.keys(topicTally).forEach(function (t) {
    if (t === "other" || topicTally[t] < 2) return;
    items.push(acItem("unresolved",
      "\u201c" + t + "\u201d has come up " + topicTally[t] + " times in the last month \u2014 it may still be open.",
      "Communication Log",
      "Add to timeline", "tab", "timeline"));
  });
  // MISSING — folders the record implies but the Organizer doesn't have.
  var folders = {};
  (d.docs || []).forEach(function (f) { folders[f.folder || "other"] = 1; });
  var allText = (d.logs || []).map(function (l) { return l.message || ""; }).join(" ") + " " + (d.timeline || []).map(function (t) { return (t.title || "") + " " + (t.details || ""); }).join(" ");
  // Shared missing-doc map (ruleClassify.ts) — tightened P1 keywords, no traps:
  // bare appointment/hearing/order are GONE (a dad's log line "I love hearing
  // the kids laugh" must never imply a Legal/Health paper). One map, never two.
  var missingRules = RECORD_HEALTH_MISSING_RULES.map(function (r) {
    return { re: r.re, folder: r.folder, label: r.label, action: r.folder === "finances" ? "Upload receipt" : r.folder === "health" ? "Upload the record" : "Upload the document" };
  });
  missingRules.forEach(function (r) {
    if (folders[r.folder]) return;
    if (!r.re.test(allText)) return;
    items.push(acItem("missing",
      "Your record mentions " + (r.folder === "finances" ? "money matters" : r.folder === "health" ? "health care" : r.folder === "school" ? "school matters" : "court matters") + " \u2014 nothing is filed in " + r.label + " yet.",
      "Your saved records",
      r.action, "tab", "organizer"));
  });
  // NEEDS DOCUMENTATION — log exchanges whose topic has no nearby timeline event.
  var docTopics = { "pickup/drop-off": 1, schedule: 1, health: 1, school: 1, legal: 1, communication: 1, "child expenses": 1 };
  var docCount = 0;
  (d.logs || []).slice(0, 120).forEach(function (l) {
    if (docCount >= 3) return;
    if (!docTopics[l.topic]) return;
    var dt = acParseDay(l.date);
    if (!dt) return;
    var days = Math.abs(acDaysFromNow(dt));
    if (days > 21) return;
    var near = (d.timeline || []).some(function (t) {
      var td = acParseDay(t.date);
      if (!td) return false;
      var diff = Math.abs((td.getTime() - dt.getTime()) / 86400000);
      return diff <= 14;
    });
    if (near) return;
    docCount += 1;
    items.push(acItem("needs_documentation",
      "The \u201c" + (l.topic || "other") + "\u201d exchange from " + acDayLabel(l.date) + " isn't on your timeline yet \u2014 record it while it's fresh.",
      "Communication Log" + acSourceDate(l.date),
      "Add to timeline", "tab", "timeline"));
  });
  // Bound + order: Upcoming first (soonest matters most), then the rest.
  var order = { upcoming: 0, unresolved: 1, missing: 2, needs_documentation: 3 };
  return items
    .sort(function (a, b) { return order[a.section] - order[b.section]; })
    .slice(0, 20);
}
// Parse the model's line format: "TEXT || SOURCE || ACTION || ACTIONTYPE || REF"
// under "### SECTION" headers. Any unparsable line is dropped; a section with no
// valid lines just stays empty (the UI renders its honest empty state).
function parseActionItems(content) {
  var items = [];
  var section = null;
  var perSection = { unresolved: 0, upcoming: 0, missing: 0, needs_documentation: 0 };
  String(content || "").split("\n").forEach(function (raw) {
    var line = raw.replace(/\r$/, "").trim();
    if (!line) return;
    if (AC_HEADERS[line]) { section = AC_HEADERS[line]; return; }
    if (!section) return;
    if (/^none$/i.test(line)) return;
    var parts = line.split("||").map(function (x) { return x.trim(); });
    if (parts.length < 3) return;
    var text = parts[0], source = parts[1], action = parts[2];
    var actionType = parts[3] && parts[3].toLowerCase() === "tab" ? "tab" : "copy";
    var ref = parts[4] || "";
    if (!text || text.length < 4) return;
    if (perSection[section] >= 8) return;
    perSection[section] += 1;
    items.push(acItem(section, text, source, action, actionType, ref.trim()));
  });
  return items.slice(0, 20);
}
var AC_SYSTEM_PROMPT = `You are "Before You Send", a calm, practical organizing assistant for a father in a co-parenting or custody situation. He has saved his own records: a Communication Log (messages sent and received with the co-parent), an Event Timeline (important moments), a Document Organizer (documents with folder, summary and tags), saved message reviews, and a Case Summary.
Below is a bounded excerpt of HIS OWN saved data. Build his "Action Center": a short list of what genuinely needs his attention right now. Use EXACTLY these four section headers, in this exact order, with nothing before the first header:
### UNRESOLVED
### UPCOMING
### MISSING
### NEEDS DOCUMENTATION

Under each header, list items ONLY as lines in this exact format (one item per line, " || " separators, no bullet characters):
TEXT || SOURCE || ACTION || ACTIONTYPE || REF

- TEXT: one short calm sentence (under 25 words) about one specific item from HIS data.
- SOURCE: where it came from with the real date when the record has one, e.g. "Communication Log · Oct 3", "Event Timeline · Oct 12", "Document Organizer", "Case Summary".
- ACTION: a short suggested next step ("Add to timeline", "Upload receipt", "Note the date", "Log the outcome").
- ACTIONTYPE: "tab" when the action can be a real button and the tab exists (timeline, log, organizer, tools) — set REF to that tab name. Otherwise "copy" with REF empty.

RULES:
- Reference ONLY facts actually present in the excerpt. Never invent names, dates, events, documents, patterns, or deadlines.
- UNRESOLVED: things still open — disagreements, conflicts, repeated topics. Nothing unresolved? Write exactly "none".
- UPCOMING: dates in the future or soon (court dates, exchanges, appointments) from the timeline, log, or case summary. Future dates only, never past ones. None? Write exactly "none".
- MISSING: documents the record implies — a bill or receipt referenced but not filed, an Organizer folder with no files. Only when the excerpt supports it. None? Write exactly "none".
- NEEDS DOCUMENTATION: timeline-worthy events mentioned in the log but not yet in the timeline. None? Write exactly "none".
- NEVER give legal advice, never predict outcomes, never say what a judge or attorney would do or think. Stay calm, neutral, and brief.
- Do not include any text outside the four section headers and their item lines.`;
function gatherActionData(u) {
  return Promise.all([readLog(), readTimeline(), readOrganizerFiles(u.id), readReviews(), readCaseSummary(u.id)]).then(function (res) {
    var logsAll = res[0], timelineAll = res[1], files = res[2], reviewsAll = res[3], cs = res[4];
    var ownLogs = logsAll.filter(function (x) { return x.userId === u.id; });
    var ownTimeline = timelineAll.filter(function (x) { return x.userId === u.id; });
    var ownReviews = reviewsAll.filter(function (x) { return x.userId === u.id; });
    var logs = ownLogs.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var timeline = ownTimeline.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var docs = files.slice(0, 40);
    var reviews = ownReviews.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 10);
    var counts = { log: ownLogs.length, timeline: ownTimeline.length, docs: files.length, reviews: ownReviews.length };
    var parts = [];
    parts.push("COMMUNICATION LOG (" + counts.log + " total, showing the " + Math.min(logs.length, 60) + " most recent):");
    if (!logs.length) parts.push("(none)");
    logs.slice(0, 60).forEach(function (l) {
      parts.push("- [" + (l.date ? csDay(l.date) : "no date") + "] " + (l.direction === "received" ? "received from co-parent" : "sent by me") + ", topic: " + (l.topic || "other") + " \u2014 " + csTruncate(l.message, 200));
    });
    parts.push("EVENT TIMELINE (" + counts.timeline + " total, showing the " + Math.min(timeline.length, 40) + " most recent):");
    if (!timeline.length) parts.push("(none)");
    timeline.slice(0, 40).forEach(function (t) {
      parts.push("- [" + (t.date || "no date") + "] " + (t.category || "other") + " \u2014 " + csTruncate(t.title, 120) + (t.details ? ": " + csTruncate(t.details, 160) : ""));
    });
    parts.push("DOCUMENT ORGANIZER (" + counts.docs + " total, showing the " + docs.length + " most recent):");
    if (!docs.length) parts.push("(none)");
    docs.forEach(function (d) {
      var label = d.title || d.summary || d.description || "document";
      parts.push("- folder: " + (d.folder || "other") + "/" + (d.category || "") + " \u2014 " + csTruncate(label, 100) + (d.summary ? " \u2014 " + csTruncate(d.summary, 160) : "") + (d.tags && d.tags.length ? " \u2014 tags: " + d.tags.slice(0, 4).join(", ") : ""));
    });
    parts.push("SAVED MESSAGE REVIEWS (" + counts.reviews + " total, showing the " + reviews.length + " most recent):");
    if (!reviews.length) parts.push("(none)");
    reviews.forEach(function (r) {
      parts.push("- draft: " + csTruncate(r.draft, 140) + (r.review ? " \u2014 review excerpt: " + csTruncate(r.review, 240) : ""));
    });
    parts.push("CASE SUMMARY (generated " + (cs ? csDay(cs.generatedAt) : "not yet") + "):");
    parts.push(cs ? csTruncate(cs.text, 1200) : "(none)");
    var excerpt = parts.join("\n").slice(0, AC_MAX_EXCERPT_CHARS);
    var version = counts.log + "|" + counts.timeline + "|" + counts.docs + "|" + counts.reviews + "|" + crypto.createHash("sha256").update(excerpt).digest("hex").slice(0, 10);
    return {
      excerpt: excerpt,
      counts: counts,
      version: version,
      total: counts.log + counts.timeline + counts.docs + counts.reviews,
      logs: logs.slice(0, 200),
      timeline: timeline.slice(0, 120),
      docs: docs,
      caseSummaryText: cs ? cs.text : ""
    };
  });
}
async function generateActionCenter(u) {
  var d = await gatherActionData(u);
  if (d.total === 0) return { empty: true, data: d, items: null, usedFallback: false };
  var items = null, usedFallback = false;
  if (llm) {
    try {
      var res = await fetch(llm.base + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + llm.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llm.model,
          stream: false,
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            { role: "system", content: AC_SYSTEM_PROMPT },
            { role: "user", content: d.excerpt }
          ]
        }),
        signal: AbortSignal.timeout(45000)
      });
      if (res.ok) {
        var j = await res.json().catch(function () { return null; });
        var content = typeof j?.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content.trim() : "";
        if (content) items = parseActionItems(content);
      }
    } catch (err) { /* fall through to the deterministic fallback */ }
  }
  if (!items || !items.length) { items = fallbackActionItems(d); usedFallback = true; }
  return { empty: false, data: d, items: items, usedFallback: usedFallback };
}
// ---- Record Health (organizer-expansion spec §1, Slice 1) -------------------
// Deterministic, LLM-free, user-scoped reads only. FAIL-OPEN: any storage error
// degrades to a calm empty snapshot (never a 500). Reuses the Action Center
// date helpers + the shared ruleClassify missing-doc map (tightened P1
// keywords — no appointment/hearing/order traps). Coverage = |D|/30 distinct
// local dates with a record from {log.date, timeline.date, doc.createdAt}.
var RH_402 = "Record Health is part of the Command Center plan.";
var RH_BANDS = [
  { max: 24, band: "Starting", line: "A record starts with one paper — you're doing it." },
  { max: 49, band: "Taking shape", line: "Every paper you add makes the picture clearer." },
  { max: 74, band: "Consistent", line: "You've built a steady habit." },
  { max: 100, band: "Solid", line: "That's a record that tells the story." }
];
var RH_TOPIC_LABELS = { "pickup/drop-off": "Pickup", schedule: "Schedule", "child expenses": "Child expenses", health: "Health", school: "School", communication: "Communication", legal: "Legal", other: "Other" };
function rhBand(pct) {
  for (var i = 0; i < RH_BANDS.length; i++) if (pct <= RH_BANDS[i].max) return RH_BANDS[i];
  return RH_BANDS[RH_BANDS.length - 1];
}
function rhDayKey(dt) {
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}
// log/doc dates are ISO instants → local date key; timeline dates are "YYYY-MM-DD"
function rhLogDocKey(d) {
  if (typeof d !== "string" || !d) return null;
  var dt = new Date(d);
  return isNaN(dt.getTime()) ? null : rhDayKey(dt);
}
function rhTimelineKey(d) {
  var dt = acParseDay(d);
  return dt ? rhDayKey(dt) : null;
}
function rhLabel(dt) {
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Quotable mention: the matched keyword ± context, snapped to word boundaries.
function rhMentionQuote(text, re) {
  var t = String(text || "");
  var m = t.match(re);
  if (!m || typeof m.index !== "number") return null;
  var idx = m.index;
  var start = Math.max(0, idx - 26);
  var end = Math.min(t.length, idx + m[0].length + 32);
  while (start > 0 && /\S/.test(t[start - 1])) start--;
  while (start > 0 && /\s/.test(t[start])) start++;
  // The keyword sits within 26 chars of the entry's start: the snap-back has
  // pulled in a sentence fragment ("Talked to the school...") that reads badly
  // after the card's "the". Start the quote at the keyword instead.
  if (start === 0 && idx > 0) start = idx;
  while (end < t.length && /\S/.test(t[end])) end++;
  var q = t.slice(start, end).replace(/\s+/g, " ").trim();
  // A leading article merges with the card template's "the" — "You mentioned
  // the custody hearing...", never "the The custody hearing...".
  q = q.replace(/^(?:The|A|An)\s+/i, "");
  if (q.length < 2) return null;
  return q.slice(0, 90);
}
function rhEmptySnapshot(degraded) {
  return {
    ok: true,
    degraded: !!degraded,
    coverage: { days: 0, total: 30, pct: 0, band: "Starting", positiveLine: "A record starts with one paper — you're doing it." },
    gap: null, streak: null, consistency: null, missing: [],
    days30: [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false],
    docs: 0, totalRecords: 0, empty: true, updatedAt: null
  };
}
async function computeRecordHealth(u) {
  var reads;
  try {
    reads = await Promise.all([
      readLogForUser(u.id),
      readTimelineForUser(u.id),
      readOrganizerFilesMeta(u.id)
    ]);
  } catch (err) { return null; }
  var logs = reads[0] || [], timeline = reads[1] || [], docs = reads[2] || [];
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var WINDOW = 30, keys = [], i, day;
  for (i = 0; i < WINDOW; i++) { day = new Date(today); day.setDate(today.getDate() - (WINDOW - 1 - i)); keys.push(rhDayKey(day)); }
  var has = {}, lastWrite = 0;
  var mark = function (k) { if (k && !has[k]) has[k] = true; };
  var touch = function (ts) { var t = new Date(ts).getTime(); if (!isNaN(t) && t > lastWrite) lastWrite = t; };
  logs.forEach(function (l) { mark(rhLogDocKey(l.date)); touch(l.createdAt); touch(l.updatedAt); });
  timeline.forEach(function (t) { mark(rhTimelineKey(t.date)); touch(t.createdAt); touch(t.updatedAt); });
  docs.forEach(function (d) { mark(rhLogDocKey(d.createdAt)); touch(d.createdAt); });
  var days = 0;
  for (i = 0; i < WINDOW; i++) if (has[keys[i]]) days++;
  var pct = Math.round((days / WINDOW) * 100);
  var band = rhBand(pct);
  // Gap — most recent maximal run of ≥7 consecutive empty days.
  var gap = null, runs = [], cur = null;
  for (i = 0; i < WINDOW; i++) {
    if (!has[keys[i]]) { if (!cur) cur = { s: i, e: i }; else cur.e = i; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  var long = runs.filter(function (r) { return (r.e - r.s + 1) >= 7; });
  if (long.length) {
    var best = long[0];
    for (i = 1; i < long.length; i++) if (long[i].e > best.e) best = long[i];
    var from = acParseDay(keys[best.s]), to = acParseDay(keys[best.e]);
    var after = new Date(to); after.setDate(to.getDate() + 1);
    gap = { from: keys[best.s], to: keys[best.e], length: best.e - best.s + 1, fromLabel: rhLabel(from), toLabel: rhLabel(to), after: rhDayKey(after), afterLabel: rhLabel(after) };
  }
  // Current streak — ≥3 consecutive days ending today, shown only when ≥3.
  var streak = 0;
  for (i = WINDOW - 1; i >= 0 && has[keys[i]]; i--) streak++;
  if (streak < 3) streak = 0;
  // Consistency — cadence across the last 4 rolling weeks (bucket 0 = most
  // recent). Most frequent non-other log topic, or the top Organizer folder.
  var bucketFor = function (k) {
    for (var b = 0; b < 4; b++) {
      var st = new Date(today); st.setDate(today.getDate() - (6 + b * 7));
      var en = new Date(today); en.setDate(today.getDate() - (b * 7));
      if (k >= rhDayKey(st) && k <= rhDayKey(en)) return b;
    }
    return -1;
  };
  var topicBuckets = {}, topicCount = {};
  logs.forEach(function (l) {
    var k = rhLogDocKey(l.date); if (!k || !has[k]) return;
    var b = bucketFor(k); if (b < 0) return;
    var t = l.topic && l.topic !== "other" ? l.topic : null;
    if (!t) return;
    if (!topicBuckets[t]) { topicBuckets[t] = [false, false, false, false]; topicCount[t] = 0; }
    topicBuckets[t][b] = true; topicCount[t]++;
  });
  var bestTopic = null;
  for (var tp in topicCount) if (!bestTopic || topicCount[tp] > topicCount[bestTopic]) bestTopic = tp;
  var consistency = null;
  if (bestTopic) {
    var tb = topicBuckets[bestTopic], tf = tb.filter(Boolean).length;
    if (tf >= 3 && tb[0]) {
      var tl = RH_TOPIC_LABELS[bestTopic] || bestTopic;
      consistency = { kind: "log", topic: bestTopic, weeks: tf, headline: tl + " log: consistent — nice.", body: tf + " of the last 4 weeks have a " + tl.toLowerCase() + " entry.", sub: "Keep it going." };
    }
  }
  if (!consistency) {
    var folderBuckets = {}, folderCount = {};
    docs.forEach(function (d) {
      var k = rhLogDocKey(d.createdAt); if (!k || !has[k]) return;
      var b = bucketFor(k); if (b < 0) return;
      var f = d.folder || "other";
      if (!folderBuckets[f]) { folderBuckets[f] = [false, false, false, false]; folderCount[f] = 0; }
      folderBuckets[f][b] = true; folderCount[f]++;
    });
    var topFolder = null;
    for (var ff in folderCount) if (!topFolder || folderCount[ff] > folderCount[topFolder]) topFolder = ff;
    if (topFolder && folderCount[topFolder] >= 3) {
      var fb = folderBuckets[topFolder], fg = fb.filter(Boolean).length;
      if (fg >= 3 && fb[0]) {
        var fl = (folderBySlug(topFolder) || { label: topFolder }).label;
        consistency = { kind: "folder", topic: topFolder, weeks: fg, headline: fl + ": consistent — nice.", body: fg + " of the last 4 weeks have a paper filed.", sub: "Keep it going." };
      }
    }
  }
  // Missing-doc — scan log + timeline text (last 21 days) with the shared
  // ruleClassify map. Suggestion only when the folder has no matching doc AND
  // the mention is quotable. At most 2, most recent first.
  var folderHasDoc = {};
  docs.forEach(function (d) { folderHasDoc[d.folder || "other"] = true; });
  var cutoff21 = new Date(today); cutoff21.setDate(today.getDate() - 20);
  var mentions = [];
  RECORD_HEALTH_MISSING_RULES.forEach(function (r) {
    if (folderHasDoc[r.folder]) return;
    var bestHit = null, consider = function (rec) { if (!bestHit || rec.order > bestHit.order) bestHit = rec; };
    logs.forEach(function (l) {
      var dt = acParseDay(l.date);
      if (!dt || dt.getTime() < cutoff21.getTime()) return;
      var q = rhMentionQuote(l.message, r.re);
      if (!q) return;
      consider({ quote: q, source: "From your log", date: l.date, dateLabel: acDayLabel(l.date), daysAgo: Math.round((today.getTime() - dt.getTime()) / 86400000), order: dt.getTime() });
    });
    timeline.forEach(function (t) {
      var dt = acParseDay(t.date);
      if (!dt || dt.getTime() < cutoff21.getTime()) return;
      var q = rhMentionQuote((t.title || "") + " " + (t.details || ""), r.re);
      if (!q) return;
      consider({ quote: q, source: "From your timeline", date: t.date, dateLabel: acDayLabel(t.date), daysAgo: Math.round((today.getTime() - dt.getTime()) / 86400000), order: dt.getTime() });
    });
    if (bestHit) mentions.push({ folder: r.folder, folderLabel: r.label, quote: bestHit.quote, source: bestHit.source, date: bestHit.date, dateLabel: bestHit.dateLabel, daysAgo: bestHit.daysAgo });
  });
  mentions.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  var missing = mentions.slice(0, 2);
  var totalRecords = logs.length + timeline.length + docs.length;
  return {
    ok: true,
    coverage: { days: days, total: WINDOW, pct: pct, band: band.band, positiveLine: band.line },
    gap: gap, streak: streak || null, consistency: consistency, missing: missing,
    days30: keys.map(function (k) { return !!has[k]; }),
    docs: docs.length, totalRecords: totalRecords, empty: totalRecords <= 2,
    updatedAt: lastWrite ? new Date(lastWrite).toISOString() : null
  };
}
async function handleRecordHealth(req) {
  // Fail-open (spec §1): any read/compute hiccup degrades to the calm empty
  // snapshot — this endpoint must never 500.
  try {
    var s = getSession(req);
    if (!s) return json3({ error: RH_402 }, 402);
    var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
    if (!u) return json3({ error: "Account not found." }, 404);
    var tier = userTier(u);
    if (tier !== "command" && tier !== "ultimate") return json3({ error: RH_402 }, 402);
    var h = await computeRecordHealth(u);
    if (!h) return json3(rhEmptySnapshot(true));
    return json3(h);
  } catch (err) {
    console.warn("[record-health] degraded:", err);
    return json3(rhEmptySnapshot(true));
  }
}
async function handleActionCenter(req, method) {
  var s = getSession(req);
  if (!s) return json3({ error: ACTION_CENTER_402 }, 402);
  var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  var tier = userTier(u);
  if (tier !== "command" && tier !== "ultimate") return json3({ error: ACTION_CENTER_402 }, 402);
  if (method === "GET") {
    var stored = await readActionCenter(u.id);
    var data = await gatherActionData(u);
    var stale = !!stored && stored.dataVersion !== data.version;
    return json3({
      summary: stored ? { items: stored.items || [], generatedAt: stored.generatedAt, dataVersion: stored.dataVersion } : null,
      counts: data.counts,
      stale: stale
    });
  }
  // Rider 8a6cf51-fix: tag every generate/regenerate event with whether a
  // previous Action Center already existed (QA 0275c3ff could not see
  // regenerates in analytics — they were indistinguishable from first builds).
  var storedBefore = await readActionCenter(u.id);
  var isRegen = !!storedBefore;
  var gen = await generateActionCenter(u);
  if (gen.empty) {
    addEvent({ vid: visitorVid(req) || "server", name: "action_center_generate", plan: tier, meta: { empty: true, regenerate: isRegen } }).catch(function (err) { console.warn("[action-center] event failed:", err); });
    return json3({ ok: true, empty: true, summary: null, counts: gen.data.counts });
  }
  await writeActionCenter(u.id, gen.items, gen.data.version);
  addEvent({ vid: visitorVid(req) || "server", name: "action_center_generate", plan: tier, meta: { fallback: gen.usedFallback, count: gen.items.length, regenerate: isRegen } }).catch(function (err) { console.warn("[action-center] event failed:", err); });
  return json3({ ok: true, summary: { items: gen.items, generatedAt: new Date().toISOString(), dataVersion: gen.data.version }, counts: gen.data.counts, fallback: gen.usedFallback });
}

var SUBSCRIPTION_PLANS = ["steady", "command", "ultimate"];
var PLAN_LABELS2 = { steady: "Steady", command: "Command Center", ultimate: "Ultimate Co-Parent", consultation: "Consultation", topup: "Review Top-Up", gift: "Gift a month of Steady", sortpile: "Sort My Pile", attorney_prep_pack: "Attorney Prep Pack", record_review: "Record Review" };
function planCents(plan, interval) {
  if (plan === "consultation")
    return Number(process.env.PRICE_CONSULTATION_USD_CENTS || 3950);
  if (plan === "attorney_prep_pack")
    return Number(process.env.PRICE_ATTORNEY_PREP_USD_CENTS || 2450);
  if (plan === "record_review")
    return Number(process.env.PRICE_RECORD_REVIEW_USD_CENTS || 2950);
  if (plan === "subscription")
    plan = "command";
  const byPlan = {
    steady: { month: Number(process.env.PRICE_STEADY_USD_CENTS || 499), year: Number(process.env.PRICE_STEADY_ANNUAL_USD_CENTS || 4990) },
    command: { month: Number(process.env.PRICE_COMMAND_USD_CENTS || process.env.PRICE_SUBSCRIPTION_USD_CENTS || 1249), year: Number(process.env.PRICE_COMMAND_ANNUAL_USD_CENTS || 12490) },
    ultimate: { month: Number(process.env.PRICE_ULTIMATE_USD_CENTS || 2499), year: Number(process.env.PRICE_ULTIMATE_ANNUAL_USD_CENTS || 24990) },
    topup: { month: Number(process.env.PRICE_REVIEW_TOPUP_USD_CENTS || 950), year: Number(process.env.PRICE_REVIEW_TOPUP_USD_CENTS || 950) },
    gift: { month: Number(process.env.PRICE_GIFT_MONTH_USD_CENTS || 499), year: Number(process.env.PRICE_GIFT_MONTH_USD_CENTS || 499) },
    sortpile: { month: Number(process.env.PRICE_SORTPILE_USD_CENTS || 1950), year: Number(process.env.PRICE_SORTPILE_USD_CENTS || 1950) }
  };
  return byPlan[plan]?.[interval] ?? 0;
}
var stripePrices = new Map;
async function resolveStripePrice(stripe, plan, interval, opts = {}) {
  const key = opts.cacheKey || `${plan}:${interval}`;
  const cached = stripePrices.get(key);
  if (cached)
    return cached;
  const cents = opts.cents ?? planCents(plan, interval);
  if (!cents)
    throw new Error(`No price configured for plan ${plan}/${interval}.`);
  const name = opts.productName || `Before You Send ${PLAN_LABELS2[plan] || plan}`;
  const isOneTime = plan === "consultation" || plan === "topup" || plan === "gift" || plan === "sortpile" || plan === "attorney_prep_pack" || plan === "record_review";
  const products = await stripe.products.list({ active: true, limit: 100 });
  const product = products.data.find((p2) => p2.name === name);
  if (product) {
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const match = prices.data.find((p2) => isOneTime ? p2.unit_amount === cents && !p2.recurring : p2.unit_amount === cents && p2.recurring?.interval === interval);
    if (match) {
      stripePrices.set(key, match.id);
      return match.id;
    }
  }
  const createParams = {
    currency: "usd",
    unit_amount: cents,
    ...isOneTime ? { product_data: { name } } : product ? { product: product.id, recurring: { interval, interval_count: 1 } } : { product_data: { name }, recurring: { interval, interval_count: 1 } }
  };
  const price = await stripe.prices.create(createParams);
  stripePrices.set(key, price.id);
  return price.id;
}
// Co-Parent Check-In coupons — idempotent create-or-retrieve by id (never
// touch products/prices). bys-checkin-50: repeating 50% for the first 3
// subscription invoices (Stripe natively drops it after 3); bys-checkin-50-once
// for one-time purchases (consultation).
var stripeCoupons = new Map;
async function resolveCheckinCoupon(stripe, once) {
  const id = once ? "bys-checkin-50-once" : "bys-checkin-50";
  const cached = stripeCoupons.get(id);
  if (cached)
    return cached;
  let coupon;
  try {
    coupon = await stripe.coupons.retrieve(id);
  } catch {
    coupon = await stripe.coupons.create({
      id,
      name: once ? "Check-In 50% (one-time)" : "Check-In 50% (first 3 months)",
      percent_off: 50,
      duration: once ? "once" : "repeating",
      ...once ? {} : { duration_in_months: 3 }
    });
  }
  stripeCoupons.set(id, coupon.id);
  return coupon.id;
}
async function handleCheckout(req) {
  if (!process.env.STRIPE_SECRET_KEY)
    return json3({ error: "Payments are not enabled yet — checkout will be active soon." }, 503);
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  let plan = String(body?.plan || "");
  if (plan === "subscription")
    plan = "command";
  const interval = body?.interval === "year" ? "year" : "month";
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  if (plan === "topup") {
    const topupPrice = await resolveStripePrice(stripe, "topup", "month");
    const origin2 = new URL(req.url).origin;
    const topupSession = await stripe.checkout.sessions.create({ mode: "payment", automatic_payment_methods: { enabled: true }, line_items: [{ price: topupPrice, quantity: 1 }], managed_payments: { enabled: false }, metadata: { plan: "topup", credits: "10" }, success_url: `${origin2}/pricing?checkout=success&plan=topup&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin2}/pricing?checkout=cancelled` });
    return json3({ url: topupSession.url, plan: "topup", interval: "month" });
  }
  if (plan === "sortpile") {
    // Sort My Pile — one-time $19.50 (1950c). Grants 30 days of the live
    // Organizer (profile.sortUntil) on confirm. Stamped with the buyer's user
    // id so a lost session cookie on the success return can still link.
    const sortPrice = await resolveStripePrice(stripe, "sortpile", "month");
    const origin4 = new URL(req.url).origin;
    const sessionUser4 = getSession(req);
    const sortSession = await stripe.checkout.sessions.create({ mode: "payment", automatic_payment_methods: { enabled: true }, line_items: [{ price: sortPrice, quantity: 1 }], managed_payments: { enabled: false }, client_reference_id: sessionUser4 ? sessionUser4.userId : undefined, metadata: { plan: "sortpile", ...sessionUser4 ? { user_id: sessionUser4.userId } : {} }, success_url: `${origin4}/pricing?checkout=success&plan=sortpile&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin4}/pricing?checkout=cancelled` });
    return json3({ url: sortSession.url, plan: "sortpile", interval: "month" });
  }
  if (plan === "attorney_prep_pack") {
    // Attorney Prep Pack — one-time $24.50 (2450c). On verified paid confirm the
    // durable grant is written (bys_attorney_packs row + profile.attorneyPrep
    // stamp); re-download stays possible (grant = entitlement; pack generation
    // is a later build). Stamped with the buyer's user id so a lost session
    // cookie on the success return can still link.
    const appPrice = await resolveStripePrice(stripe, "attorney_prep_pack", "month");
    const origin5 = new URL(req.url).origin;
    const sessionUser5 = getSession(req);
    const appSession = await stripe.checkout.sessions.create({ mode: "payment", automatic_payment_methods: { enabled: true }, line_items: [{ price: appPrice, quantity: 1 }], managed_payments: { enabled: false }, client_reference_id: sessionUser5 ? sessionUser5.userId : undefined, metadata: { plan: "attorney_prep_pack", ...sessionUser5 ? { user_id: sessionUser5.userId } : {} }, success_url: `${origin5}/pricing?checkout=success&plan=attorney_prep_pack&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin5}/pricing?checkout=cancelled` });
    return json3({ url: appSession.url, plan: "attorney_prep_pack", interval: "month" });
  }
  if (plan === "record_review") {
    // Record Review — one-time $29.50 (2950c). On verified paid confirm a
    // durable grant is written (bys_record_reviews row kind='purchase' +
    // profile.recordReview stamp). Ultimate members redeem their 1/year
    // allowance instead — that path writes a kind='redemption' row (amount 0)
    // when the review runs (Stage 2); the window is enforced by created_at.
    // Stamped with the buyer's user id so a lost session cookie on the success
    // return can still link.
    const rrPrice = await resolveStripePrice(stripe, "record_review", "month");
    const origin6 = new URL(req.url).origin;
    const sessionUser6 = getSession(req);
    const rrSession = await stripe.checkout.sessions.create({ mode: "payment", automatic_payment_methods: { enabled: true }, line_items: [{ price: rrPrice, quantity: 1 }], managed_payments: { enabled: false }, client_reference_id: sessionUser6 ? sessionUser6.userId : undefined, metadata: { plan: "record_review", ...sessionUser6 ? { user_id: sessionUser6.userId } : {} }, success_url: `${origin6}/pricing?checkout=success&plan=record_review&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin6}/pricing?checkout=cancelled` });
    return json3({ url: rrSession.url, plan: "record_review", interval: "month" });
  }
  if (plan !== "consultation" && !SUBSCRIPTION_PLANS.includes(plan))
    return json3({ error: "Choose a valid plan." }, 400);
  const isCheckin = body?.checkin === true;
  const isIntro = plan === "ultimate" && interval === "month" && body?.offer === true && !isCheckin;
  const priceId = isIntro ? await resolveStripePrice(stripe, "ultimate", "month", { cents: Number(process.env.PRICE_ULTIMATE_INTRO_USD_CENTS || 1999), productName: "Before You Send Ultimate Co-Parent", cacheKey: "ultimate:intro" }) : await resolveStripePrice(stripe, plan, interval);
  const origin = new URL(req.url).origin;
  const successPath = plan === "consultation" ? "/consultations" : "/pricing";
  const cancelPath = plan === "consultation" ? "/consultations" : "/pricing";
  const sessionUser = getSession(req);
  const coupon = isCheckin ? await resolveCheckinCoupon(stripe, plan === "consultation") : undefined;
  const checkinMeta = isCheckin
    ? {
        checkin: "true",
        q1: typeof body?.q1 === "string" ? body.q1.slice(0, 40) : undefined,
        q2: typeof body?.q2 === "string" ? body.q2.slice(0, 40) : undefined,
        q3: typeof body?.q3 === "string" ? body.q3.slice(0, 40) : undefined,
        rec: typeof body?.rec === "string" ? body.rec.slice(0, 40) : undefined
      }
    : {};
  const session = await stripe.checkout.sessions.create({
    mode: plan === "consultation" ? "payment" : "subscription",
    automatic_payment_methods: { enabled: true },
    line_items: [{ price: priceId, quantity: 1 }],
    managed_payments: { enabled: false },
    client_reference_id: sessionUser ? sessionUser.userId : undefined,
    metadata: plan === "consultation" ? { plan, type: "consultation", ...sessionUser ? { user_id: sessionUser.userId } : {}, ...checkinMeta } : { plan, interval, ...isIntro ? { offer: "true" } : {}, ...sessionUser ? { user_id: sessionUser.userId } : {}, ...checkinMeta },
    discounts: coupon ? [{ coupon }] : undefined,
    success_url: `${origin}${successPath}?checkout=success&plan=${plan}&interval=${interval}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${cancelPath}?checkout=cancelled`
  });
  return json3({ url: session.url, plan, interval, offer: isIntro, checkin: isCheckin });
}
function tierFromCheckoutSession(session) {
  const mp = session.metadata?.plan;
  if (mp === "steady" || mp === "command" || mp === "ultimate")
    return { tier: mp, interval: session.metadata?.interval === "year" ? "year" : "month" };
  const map = [
    [499, "steady", "month"],
    [4990, "steady", "year"],
    [1249, "command", "month"],
    [12490, "command", "year"],
    [1999, "ultimate", "month"], // launch intro (first payment at the intro rate)
    [2499, "ultimate", "month"],
    [24990, "ultimate", "year"]
  ];
  const hit = map.find(([cents]) => cents === session.amount_total);
  return hit ? { tier: hit[1], interval: hit[2] } : null;
}
async function handlePortal(req) {
  const s = getSession(req);
  if (!s)
    return json3({ error: "Sign in required." }, 401);
  if (!process.env.STRIPE_SECRET_KEY)
    return json3({ error: "Payments are not enabled yet." }, 503);
  const users = await readUsers(), u = users.find((x2) => x2.id === s.userId);
  if (!u)
    return json3({ error: "Account not found." }, 404);
  const customerId = u.profile?.stripeCustomerId;
  if (!customerId)
    return json3({ error: "No active paid subscription is linked to this account." }, 404);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  try {
    const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: new URL("/home", req.url).toString() });
    return json3({ ok: true, url: portal.url });
  } catch {
    return json3({ error: "We couldn't open the billing portal right now." }, 502);
  }
}
async function handleCheckoutConfirm(req) {
  if (!process.env.STRIPE_SECRET_KEY)
    return json3({ error: "Payments are not enabled yet." }, 503);
  let body;
  try {
    body = await req.json();
  } catch {
    return json3({ error: "Invalid request." }, 400);
  }
  const sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : "";
  if (!sessionId)
    return json3({ error: "Missing session_id." }, 400);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return json3({ error: "We couldn't find that checkout session." }, 404);
  }
  if (session.payment_status !== "paid")
    return json3({ error: "This purchase hasn't completed yet — nothing has been charged." }, 402);
  const users = await readUsers();
  // Resolve the account: cookie session first; then fall back to the user id we
  // stamped on the checkout session (client_reference_id / metadata.user_id) so
  // a lost session cookie (cold start, deploy, cleared cookies) can still link.
  const s = getSession(req);
  // Which account was the checkout itself stamped for? (client_reference_id
  // wins over metadata.user_id — the same priority as the original fallback.)
  const sessionUserId = (typeof session.client_reference_id === "string" && session.client_reference_id) ? session.client_reference_id : (typeof session.metadata?.user_id === "string" && session.metadata.user_id ? session.metadata.user_id : "");
  let u = s ? users.find((x2) => x2.id === s.userId) : null;
  // Ownership (audit ac135af1 M2): when the cookie session resolves the user,
  // the checkout must belong to that SAME account — a session stamped for
  // someone else is rejected, and a session whose Stripe customer is already
  // linked to a different account is rejected too. The stamped-id fallbacks
  // below remain for a lost session cookie (cold start, deploy, cleared
  // cookies) and only ever grant to the exact user the checkout was made for.
  if (u && sessionUserId && sessionUserId !== u.id)
    return json3({ error: "This purchase belongs to a different account. Sign in with the account you bought it with." }, 403);
  if (u) {
    const sessionCust = typeof session.customer === "string" ? session.customer : (session.customer?.id || "");
    if (sessionCust) {
      // Stripe creates a NEW Customer per Checkout Session (session creation
      // never passes customer/customer_email), so after a first confirm stamps
      // this account's stripeCustomerId, the session's customer can never equal
      // it again — the old self-comparison 403'd every repeat purchase on the
      // same account (audit 25ffae58 H1). The ownership check is therefore:
      // does this session's Stripe customer already belong to a DIFFERENT
      // account? A fresh Stripe customer matches nobody, so the grant proceeds
      // and stamps as today. Gift/topup/sortpile/consultation branches all flow
      // through this single guard.
      const custOwner = users.find((x2) => x2.id !== u.id && x2.profile?.stripeCustomerId && x2.profile.stripeCustomerId === sessionCust);
      if (custOwner)
        return json3({ error: "This purchase belongs to a different account. Sign in with the account you bought it with." }, 403);
    }
  }
  if (!u && sessionUserId)
    u = users.find((x2) => x2.id === sessionUserId) || null;
  if (!u)
    return json3({ error: "Sign in to link a purchase to your account." }, 401);
  const processed = Array.isArray(u.profile?.processedSessions) ? u.profile.processedSessions : [];
  if (processed.includes(sessionId)) {
    const k2 = session.metadata?.plan === "sortpile" ? "sortpile" : undefined;
    return json3({ ok: true, alreadyProcessed: true, tier: u.profile?.tier, credits: Number(u.profile?.credits || 0), ...(k2 ? { kind: k2, sortUntil: u.profile?.sortUntil } : {}) });
  }
  const now = new Date;
  // Round-6 funnel: canonical "any verified paid grant" event (server-side
  // single source of truth, mirroring the `paid` event's philosophy). Fires
  // exactly once per Stripe session because the processedSessions early-return
  // above gates every branch below. Meta carries kind/plan/interval only.
  const logPurchaseCompleted = (kind: string, planName?: string, interval?: string) => {
    addEvent({ vid: visitorVid(req) || "server", name: "purchase_completed", plan: planName || session.metadata?.plan || "payment", meta: { kind, ...(interval ? { interval } : {}) } }).catch((err) => console.warn("[checkout] purchase_completed event failed:", err));
  };
  if (session.mode === "payment") {
    if (session.metadata?.plan === "topup") {
      const n = Number(session.metadata?.credits || 10);
      const grant = applyTopUpGrant(u.profile, n, sessionId);
      u.profile = grant.profile;
      await writeUsers(users);
      logPurchaseCompleted("topup", "topup");
      return json3({ ok: true, kind: "topup", credits: grant.credits });
    }
    if (session.metadata?.plan === "gift") {
      // One-time payment verified -> mint the single-use code. The giver's own
      // profile is untouched (no invented reward — owner decision §10 default).
      // L3: the mint is atomic per Stripe session — bys_gift_codes.session_id
      // is UNIQUE, so two parallel confirms (two tabs on the success URL) can
      // never mint two codes: the pre-check returns an already-minted code and
      // the second INSERT falls back to the first row on the constraint.
      const already = await getGiftCodeBySession(sessionId);
      let gRow = already;
      if (!gRow) {
        const code = makeGiftCode();
        try {
          gRow = await insertGiftCode({ id: code, giverId: u.id, months: 1, sessionId });
        } catch {
          gRow = await getGiftCodeBySession(sessionId);
        }
      }
      if (!gRow) {
        // Insert failed for a non-conflict reason — leave the session
        // unprocessed so a retry can still mint; never fabricate a code.
        console.error("[gift] code mint failed for session", sessionId);
        return json3({ error: "We couldn't create your gift code right now — try again." }, 500);
      }
      u.profile = { ...u.profile || {}, processedSessions: [...processed, sessionId] };
      await writeUsers(users);
      logPurchaseCompleted("gift", "gift");
      const gCreated = gRow.createdAt ? new Date(gRow.createdAt).getTime() : Date.now();
      return json3({ ok: true, kind: "gift", gift: { code: gRow.id, validUntil: new Date(gCreated + 90 * 24 * 60 * 60 * 1000).toISOString() } });
    }
    if (session.metadata?.plan === "sortpile") {
      // Sort My Pile: grant 30 days of the live Organizer (sortUntil). Rolled
      // forward from the latest of now / any existing sortUntil so a second
      // purchase stacks instead of being wasted. Idempotent via processedSessions.
      const base = Math.max(Date.now(), new Date(u.profile?.sortUntil || 0).getTime());
      const sortUntil = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();
      u.profile = { ...u.profile || {}, sortUntil, processedSessions: [...processed, sessionId] };
      await writeUsers(users);
      logPurchaseCompleted("sortpile", "sortpile");
      addEvent({ vid: visitorVid(req) || "server", name: "sortpile_purchase", plan: userTier(u), meta: { sortUntil } }).catch(function (err) { console.warn("[sortpile] purchase event failed:", err); });
      return json3({ ok: true, kind: "sortpile", sortUntil });
    }
    if (session.metadata?.plan === "attorney_prep_pack") {
      // Attorney Prep Pack (2026-08-12): durable grant on verified paid confirm.
      // profile.attorneyPrep is the sync entitlement stamp (Ultimate OR stamp =
      // entitled); the bys_attorney_packs row is the canonical durable record —
      // ON CONFLICT (session_id) makes a double-confirm safe, and processedSessions
      // guards the stamp. Re-download stays possible; pack generation/download is
      // a later build.
      u.profile = { ...u.profile || {}, attorneyPrep: true, processedSessions: [...processed, sessionId] };
      await writeUsers(users);
      logPurchaseCompleted("attorney_prep_pack", "attorney_prep_pack");
      insertAttorneyPack({
        userId: u.id,
        email: u.email || "",
        amountCents: typeof session.amount_total === "number" ? session.amount_total : 0,
        sessionId
      }).catch((err) => console.warn("[attorney-prep] insert failed:", err));
      addEvent({ vid: visitorVid(req) || "server", name: "attorney_prep_pack_purchase", plan: "attorney_prep_pack", meta: { sessionId } }).catch((err) => console.warn("[attorney-prep] event failed:", err));
      return json3({ ok: true, kind: "attorney_prep_pack" });
    }
    if (session.metadata?.plan === "record_review") {
      // Record Review (2026-08-13, Stage 1 money path): durable grant on verified
      // paid confirm. profile.recordReview is the sync stamp; the
      // bys_record_reviews row (kind='purchase') is the canonical durable record —
      // ON CONFLICT (session_id) makes a double-confirm safe, and processedSessions
      // guards the stamp. Ultimate members' 1/year allowance is a separate path:
      // their redemption writes a kind='redemption' row (amount 0) when the review
      // runs (Stage 2) — same table, same 365-day window.
      u.profile = { ...u.profile || {}, recordReview: true, processedSessions: [...processed, sessionId] };
      await writeUsers(users);
      logPurchaseCompleted("record_review", "record_review");
      insertRecordReview({
        userId: u.id,
        email: u.email || "",
        kind: "purchase",
        amountCents: typeof session.amount_total === "number" ? session.amount_total : 0,
        sessionId
      }).catch((err) => console.warn("[record-review] insert failed:", err));
      addEvent({ vid: visitorVid(req) || "server", name: "record_review_purchase", plan: "record_review", meta: { sessionId } }).catch((err) => console.warn("[record-review] event failed:", err));
      return json3({ ok: true, kind: "record_review" });
    }
    u.profile = { ...u.profile || {}, processedSessions: [...processed, sessionId] };
    await writeUsers(users);
    if (session.metadata?.plan === "consultation") {
      // Durable consultation record (audit 25ffae58 H4): owner-facing surface is
      // a post-freeze background item — the durable row is the deliverable.
      // ON CONFLICT (session_id) makes a double-confirm safe. amount_total is
      // cents; the session is a paid one-time payment here so it is set.
      insertConsultation({
        userId: u.id,
        email: u.email || "",
        amountCents: typeof session.amount_total === "number" ? session.amount_total : 0,
        sessionId
      }).catch((err) => console.warn("[consultation] insert failed:", err));
      logPurchaseCompleted("consultation", "consultation");
      addEvent({ vid: visitorVid(req) || "server", name: "consultation_purchased", plan: "consultation", meta: { sessionId } }).catch((err) => console.warn("[consultation] event failed:", err));
    }
    return json3({ ok: true, kind: "payment" });
  }
  if (session.mode !== "subscription")
    return json3({ error: "That session isn't a subscription." }, 400);
  const mapped = tierFromCheckoutSession(session);
  if (!mapped)
    return json3({ error: "We couldn't match that session to a plan." }, 400);
  const renews = new Date(now);
  if (mapped.interval === "year")
    renews.setFullYear(renews.getFullYear() + 1);
  else
    renews.setMonth(renews.getMonth() + 1);
  u.profile = {
    ...u.profile || {},
    stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || u.profile?.stripeCustomerId,
    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id || u.profile?.stripeSubscriptionId,
    tier: mapped.tier,
    tierSince: u.profile?.tierSince || now.toISOString(),
    tierRenewsAt: renews.toISOString(),
    processedSessions: [...processed, sessionId]
  };
  await writeUsers(users);
  // Server-side funnel record — the owner dashboard's "paid" step no longer
  // depends on client JS firing (which is what broke during the incident).
  // Conversion-tracking Fixes 4+5 (audit 85fbc48d): stamp the buyer session's
  // source/campaign (a Google Ads click survives checkout) and skip the write
  // when a `paid` row for this vid landed in the last 5 minutes (single source
  // of truth — no double-count when both paths ever fire).
  {
    const paidVid = req.headers.get("cookie")?.match(/(?:^|;\s*)bys_vid=([^;]+)/)?.[1] || "server";
    const recent = await paidEventRecent(paidVid).catch(() => false);
    if (!recent) {
      const sess = await getSessionAttribution(paidVid).catch(function () { return null; });
      addEvent({
        vid: paidVid,
        name: "paid",
        plan: mapped.tier,
        meta: { interval: mapped.interval, ...(sess?.source ? { source: sess.source, ...(sess.campaign ? { campaign: sess.campaign } : {}) } : {}) }
      }).catch((err) => console.warn("[checkout] paid event failed:", err));
    }
  }
  logPurchaseCompleted("subscription", mapped.tier, mapped.interval);
  let introOffer = false;
  if (session.metadata?.offer === "true") {
    try {
      const sched = await createIntroSchedule(stripe, session);
      introOffer = !!sched;
      if (!sched)
        console.warn("[checkout] intro offer: no subscription on session, schedule skipped");
    } catch (err) {
      console.error("[checkout] intro schedule creation failed:", err);
    }
  }
  return json3({ ok: true, tier: mapped.tier, interval: mapped.interval, paymentStatus: session.payment_status, introOffer });
}

// Stripe webhook (H2): receives checkout.session.completed and
// customer.subscription.deleted/canceled. Mirrors handleCheckoutConfirm's grant
// logic (idempotent via processedSessions) so a buyer who never returns to the
// success URL still gets their tier, and portal cancellations downgrade to free.
// Fail-safe: with no STRIPE_WEBHOOK_SECRET configured we verify nothing and 200
// WITHOUT processing — unsigned events are never trusted.
async function handleStripeWebhook(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw = await req.text();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing", { apiVersion: "2025-02-24.acacia" });
  let event;
  if (secret) {
    const sig = req.headers.get("stripe-signature") || "";
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch {
      console.warn("[webhook] signature verification failed");
      return json3({ error: "Invalid signature." }, 400);
    }
  } else {
    console.warn("[webhook] STRIPE_WEBHOOK_SECRET not configured — dropping event unprocessed:", raw.slice(0, 160));
    return new Response(null, { status: 200 });
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const users = await readUsers();
      const u = users.find((x) => session.client_reference_id && x.id === session.client_reference_id) ||
        users.find((x) => x.profile?.stripeCustomerId && x.profile.stripeCustomerId === (typeof session.customer === "string" ? session.customer : session.customer?.id));
      if (!u) {
        console.warn("[webhook] checkout completed but no user matched session", session.id);
        return json3({ ok: true });
      }
      const processed = Array.isArray(u.profile?.processedSessions) ? u.profile.processedSessions : [];
      if (processed.includes(session.id))
        return json3({ ok: true, idempotent: true });
      // M1: one-time plans (gift 499c, topup 950c, consultation 3950c) are
      // granted ONLY by the confirm path — the webhook must never map a gift
      // session to steady/month (999c collision) or stamp processedSessions.
      if (session.mode !== "subscription")
        return json3({ ok: true });
      const mapped = tierFromCheckoutSession(session);
      if (!mapped) {
        console.warn("[webhook] no tier mapping for session", session.id);
        return json3({ ok: true });
      }
      const now = new Date();
      const renews = new Date(now);
      if (mapped.interval === "year") renews.setFullYear(renews.getFullYear() + 1);
      else renews.setMonth(renews.getMonth() + 1);
      u.profile = {
        ...u.profile || {},
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || u.profile?.stripeCustomerId,
        stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id || u.profile?.stripeSubscriptionId,
        tier: mapped.tier,
        tierSince: u.profile?.tierSince || now.toISOString(),
        tierRenewsAt: renews.toISOString(),
        processedSessions: [...processed, session.id]
      };
      await writeUsers(users);
      if (session.metadata?.offer === "true" && mapped.tier === "ultimate") {
        createIntroSchedule(stripe, session).catch((err) => console.warn("[webhook] intro schedule failed:", err));
      }
      console.log("[webhook] granted tier", mapped.tier, "to", u.email);
    } else if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.canceled") {
      const sub = event.data.object;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      const users = await readUsers();
      const u = users.find((x) => x.profile?.stripeCustomerId && x.profile.stripeCustomerId === customerId);
      if (!u) return json3({ ok: true });
      u.profile = { ...u.profile || {}, tier: "free", tierSince: undefined, tierRenewsAt: undefined };
      await writeUsers(users);
      console.log("[webhook] subscription ended — downgraded", u.email, "to free");
    }
  } catch (err) {
    console.error("[webhook] processing failed:", err);
  }
  return json3({ ok: true });
}
function introPhaseEndSeconds(currentPeriodEnd) {
  const d2 = new Date(currentPeriodEnd * 1000);
  const day = d2.getUTCDate();
  d2.setUTCMonth(d2.getUTCMonth() + 2, 1);
  const dim = new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth() + 1, 0)).getUTCDate();
  d2.setUTCDate(Math.min(day, dim));
  return Math.floor(d2.getTime() / 1000);
}
function applyTopUpGrant(profile, n, sessionId) {
  const credits = (Number(profile?.credits) || 0) + n;
  const processedSessions = [...Array.isArray(profile?.processedSessions) ? profile.processedSessions : [], sessionId];
  return { profile: { ...profile || {}, credits, processedSessions }, credits };
}
async function createIntroSchedule(stripe, session) {
  const subId = typeof session.subscription === "string" ? session.subscription : null;
  if (!subId)
    return null;
  const existing = await stripe.subscriptionSchedules.list({ subscription: subId, limit: 1 });
  if (existing.data.length > 0)
    return { scheduleId: existing.data[0].id };
  const sub = await stripe.subscriptions.retrieve(subId);
  const introPrice = await resolveStripePrice(stripe, "ultimate", "month", { cents: Number(process.env.PRICE_ULTIMATE_INTRO_USD_CENTS || 1999), productName: "Before You Send Ultimate Co-Parent", cacheKey: "ultimate:intro" });
  const standardPrice = await resolveStripePrice(stripe, "ultimate", "month");
  const schedule = await stripe.subscriptionSchedules.create({
    from_subscription: subId,
    phases: [
      { items: [{ price: introPrice, quantity: 1 }], end_date: introPhaseEndSeconds(sub.current_period_end) },
      { items: [{ price: standardPrice, quantity: 1 }] }
    ]
  });
  return { scheduleId: schedule.id };
}
// Conversion-tracking Fixes 1+4 (audit 85fbc48d): derive the session's
// attribution from the page_view event — the sanitized path's ad params are in
// meta.attribution (client side), with a path-query fallback for robustness, and
// the referrer label when no ad params exist. medium is "cpc" for Google ads
// params, "referral" otherwise (spec Fix 4); campaign = gad_campaignid value.
function parseAttribution(meta: any): Record<string, string | undefined> {
  const path = typeof meta?.path === "string" ? meta.path : "";
  const att = meta?.attribution && typeof meta.attribution === "object" ? meta.attribution : {};
  const qs = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  const q = new URLSearchParams(qs);
  const get = (k: string): string | undefined => {
    if (typeof att[k] === "string" && att[k]) return String(att[k]);
    const v = q.get(k);
    return v || undefined;
  };
  const gclid = get("gclid");
  const gbraid = get("gbraid");
  const wbraid = get("wbraid");
  const ttclid = get("ttclid");
  const hasGad = qs.includes("gad_") || Object.keys(att).some((k) => k.startsWith("gad_"));
  const ref = typeof meta?.referrer === "string" ? meta.referrer : "";
  let source: string;
  if (gclid || hasGad) source = "google";
  else if (ttclid) source = "tiktok";
  else if (ref) {
    let host = "";
    try { host = new URL(ref).hostname.toLowerCase(); } catch { host = ref.toLowerCase().split("/")[0] || ""; }
    if (host.includes("tiktok.com")) source = "tiktok";
    else if (host.includes("google.")) source = "google";
    else if (host.includes("beforeyousend.org") || host.includes("before-you-send.vercel.app") || host.includes("bys-app.vercel.app") || host.includes("ctonew.app")) source = "direct";
    else source = "other";
  } else source = "direct";
  const medium = gclid || hasGad ? "cpc" : "referral";
  const campaign = get("gad_campaignid") || get("gad_campaign") || undefined;
  return { source, medium, campaign, gclid, gbraid, wbraid, ttclid };
}
async function handleEvents(req: Request) {
  let body:any = {};
  try { body = await req.json(); } catch { try { body = JSON.parse(await req.text()); } catch {} }
  const vid = typeof body?.vid === "string" && body.vid.length < 100 ? body.vid : crypto.randomUUID();
  const name = typeof body?.name === "string" ? body.name.slice(0,80) : "";
  if (!name) return new Response(null, { status: 400 });
  const plan = typeof body?.plan === "string" ? body.plan.slice(0,40) : undefined;
  let meta = body?.meta && typeof body.meta === "object" ? body.meta : {};
  // PII (audit MED): /confirm?token=... and /redeem?code=... put one-time
  // credentials in the URL search string, and the raw path is persisted in
  // bys_events.meta.path AND bys_session_play.path. Strip token/code query
  // params at ingest (before any persist point); ttclid/gclid and every other
  // param are kept so source attribution and referrer data survive.
  const scrubUrl = (u: string): string => {
    const qIdx = u.indexOf("?");
    if (qIdx === -1) return u;
    const base = u.slice(0, qIdx);
    const kept = u.slice(qIdx + 1).split("&").filter((seg: string) => !/^(token|code)=/i.test(seg));
    return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
  };
  if (typeof meta.path === "string" && /[?&](token|code)=/i.test(meta.path)) {
    meta = { ...meta, path: scrubUrl(meta.path) };
  }
  if (typeof meta.landingPath === "string" && /[?&](token|code)=/i.test(meta.landingPath)) {
    meta = { ...meta, landingPath: scrubUrl(meta.landingPath) };
  }
  // Metrics 2.0 — session play. sp_* rows (page enter/exit, scroll samples) are
  // replay-only: they land in bys_session_play but NEVER in bys_events, so the
  // funnel/hourly/depth panels stay clean. Regular events ALSO get a
  // session-play row (with the client-derived dt/t durations) so the owner's
  // playback timeline mixes real funnel moments with scroll/enter/exit samples.
  // num() clamps dt/t/depthPct to the Postgres INT range (audit MED): the
  // columns are INT and an unclamped value >= 2^31 would overflow and 500 the
  // ingest; negatives are clamped to 0.
  const INT_MAX = 2147483647;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.min(INT_MAX, Math.max(0, Math.round(v))) : typeof v === "string" && v !== "" ? (isFinite(Number(v)) ? Math.min(INT_MAX, Math.max(0, Math.round(Number(v)))) : undefined) : undefined);
  const isPlay = name.startsWith("sp_") || (meta as any)?.sp === true;
  const spKind = typeof (meta as any)?.kind === "string" ? String((meta as any).kind).slice(0, 20) : "event";
  const kind = isPlay && (spKind === "scroll" || spKind === "page_enter" || spKind === "page_exit" || spKind === "ping") ? spKind : "event";
  // Play rows must carry a label: their kind ("page_enter"/"page_exit"/"scroll")
  // doubles as the human name so bys_session_play.name is never NULL and the
  // /owner timeline always has something to render (owner.tsx playLabel falls
  // back to name for kind="event" rows). Regular events keep their real name.
  const playRowBase = { vid, kind, name: isPlay ? kind : name, dt: num((meta as any)?.dt), t: num((meta as any)?.t), depthPct: num((meta as any)?.depthPct), path: typeof (meta as any)?.path === "string" ? String((meta as any).path).slice(0, 300) : undefined };
  // Meta cap (audit MED): never persist a bloated JSONB. If the serialized meta
  // exceeds ~2KB we DROP the meta and keep the row — truncating JSON would
  // corrupt it, and rejecting the whole event would lose the funnel signal. The
  // dt/t/depthPct/path/kind fields were already extracted above, so the
  // playback timeline loses nothing — only attacker bloat does. The ingest can
  // never 500 on a huge meta.
  if (JSON.stringify(meta).length > 2048) meta = {};
  // Phase 2 (metrics attribution, 2026-08-11): bys_sessions.entry_path is the
  // /api/events beacon path for nearly every session, so source attribution
  // broke (Google Ads clicks looked like direct/internal). The first page_view's
  // meta.path IS the real landing URL (with gad_source/gclid/ttclid). Persist it
  // into the session row (first-write-wins) alongside entry_path — never blocks
  // ingest. token/code params were already scrubbed above.
  if (name === "page_view" && typeof meta.path === "string" && meta.path.startsWith("/") && !meta.path.startsWith("/api/")) {
    // Conversion-tracking Fixes 1+2+4 (audit 85fbc48d): the session row is
    // created/updated ONLY from genuine page_view events — true landing path
    // (sanitized — ad params live in meta.attribution), document.referrer
    // captured client-side, request UA, and first-write-wins attribution
    // columns (source/medium/campaign/gclid/gbraid/wbraid/ttclid). Awaited +
    // UPSERT semantics (storage): guarantees the FIRST page_view's values win
    // even when the /api/events beacon's session row hasn't committed yet.
    await upsertSessionFromPageView(vid, {
      path: meta.path.slice(0, 500),
      landingPath: typeof meta.landingPath === "string" ? meta.landingPath.slice(0, 500) : undefined,
      referrer: typeof meta.referrer === "string" ? meta.referrer.slice(0, 500) : undefined,
      ua: req.headers.get("user-agent") || undefined,
      attribution: parseAttribution(meta),
    }).catch(function (err) { console.warn("[events] session upsert failed:", err); });
  }
  // Conversion-tracking Fix 4 (audit 85fbc48d): stamp the session's stored
  // source/campaign onto conversion events so the funnel reads attribution at
  // conversion, not the client's "direct"/"intake-direct" code-path label.
  // Falls back to the client's own meta when the session has no attribution.
  if ((name === "account_created" || name === "paid") && (!meta.source || meta.source === "direct" || meta.source === "intake-direct")) {
    const sess = await getSessionAttribution(vid).catch(function () { return null; });
    if (sess?.source) { meta = { ...meta, source: sess.source, ...(sess.campaign ? { campaign: sess.campaign } : {}) }; }
  }
  // Conversion-tracking Fix 5 (audit 85fbc48d): server-side dedup guard — a
  // second `paid` for the same vid within 5 minutes is ignored (the server
  // confirm write is the single source of truth; this catches stragglers).
  if (name === "paid" && (await paidEventRecent(vid).catch(() => false))) {
    return new Response(null, { status: 204, headers: { "Set-Cookie": `bys_vid=${vid}; Max-Age=31536000; Path=/; SameSite=Lax${sharedDomainAttr(requestHost(req))}` } });
  }
  const playRow = { ...playRowBase, meta };
  if (isPlay) {
    await addSessionPlay(playRow);
  } else {
    await addEvent({ vid, name, plan, meta });
    await addSessionPlay(playRow);
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": `bys_vid=${vid}; Max-Age=31536000; Path=/; SameSite=Lax${sharedDomainAttr(requestHost(req))}` } });
}
async function handleMetrics(req: Request) {
  const owner = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!owner) return json3({ error: "Not available" }, 404);
  const session = getSession(req);
  if (!session) return json3({ error: "Not available" }, 404);
  const users = await readUsers();
  const user = users.find((u:any) => u.id === session.userId);
  if (!user || String(user.email).toLowerCase() !== owner) return json3({ error: "Not available" }, 404);
  const summary:any = await metricsSummary();
  const counts:any = Object.fromEntries((summary.funnel || []).map((x:any) => [x.name, Number(x.count)]));
  // Strict funnel steps — the acquisition path is signup-first (ads land on
  // /login and create an account there), so the funnel is page_view →
  // review_completed → email captured → account created → checkout → paid.
  // Fix 7 (audit 85fbc48d): the acquisition path is intake-first — ads land on
  // /login, answer 3 Co-Parent Check-In questions, then sign up — so the intake
  // stages are visible in the funnel; review_started marks the use-first entry.
  const steps = ["page_view","login_intake_started","login_intake_completed","email_captured","account_created","review_started","checkout_started","paid"];
  const MIN_SAMPLE = 20;
  const funnel = steps.map((name, i) => {
    const count = counts[name] || 0;
    const base = i === 0 ? null : (counts[steps[i-1]] || 0);
    let rate = 0, drop = 0, sampleTooSmall = false;
    if (i === 0) {
      rate = 100;
    } else if (base && base > 0) {
      rate = Math.round(count / base * 1000) / 10;
      drop = Math.round((1 - count / base) * 1000) / 10;
      // Honest guardrail: don't present a conversion/drop-off as meaningful
      // until the step's base has a real sample.
      if (base < MIN_SAMPLE) sampleTooSmall = true;
    }
    return { name, count, base, rate, drop, sampleTooSmall };
  });
  return json3({ ...summary, funnel, totals: counts }, 200, { "Cache-Control": "no-store" });
}
// ---- Owner dashboard: Customers view (build 2, owner 2026-08-13) -------------
// One row per account signup (newest first) with attribution (source/campaign/
// landing from the account_created event + its session), tier, trial status,
// and paid state — plus the customer-action big numbers (signups / paid /
// reviews completed / checkouts initiated, today + all-time), the source
// split, and the per-source signup→paid funnel for the day. Same owner gate as
// handleMetrics. Every number is a live table read or a direct per-user
// derivation; nothing is fabricated. Test-account hiding happens client-side
// (persisted toggle) — this endpoint returns everything.
const CUSTOMERS_MIN_SAMPLE = 20;
const CUSTOMERS_TIER_LABELS: Record<string, string> = { free: "Free", steady: "Steady", command: "Command Center", ultimate: "Ultimate" };
const CUSTOMERS_SOURCE_LABELS: Record<string, string> = { google: "Google", tiktok: "TikTok", direct: "Direct", other: "Other" };
function customersSourceKind(raw: string): string {
  const s = String(raw || "").toLowerCase();
  if (s === "google" || s === "tiktok") return s;
  if (s === "intake-direct" || s === "direct" || s === "") return "direct";
  return "other";
}
function customersPathOnly(p: unknown): string {
  if (typeof p !== "string" || !p) return "";
  return p.split("?")[0] || "";
}
async function handleCustomers(req: Request) {
  const owner = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!owner) return json3({ error: "Not available" }, 404);
  const session = getSession(req);
  if (!session) return json3({ error: "Not available" }, 404);
  const users = await readUsers();
  const user = users.find((u: any) => u.id === session.userId);
  if (!user || String(user.email).toLowerCase() !== owner) return json3({ error: "Not available" }, 404);
  const data = await customerMetrics();
  const usersAll: any[] = (data?.users || []) as any[];
  const trials: any[] = (data?.trials || []) as any[];
  const acEvents: any[] = (data?.acEvents || []) as any[];
  const sessByVid = new Map(((data?.sessions || []) as any[]).map((s: any) => [s.vid, s]));
  const startDay = new Date(); startDay.setUTCHours(0, 0, 0, 0);
  const dayMs = startDay.getTime();
  const nowMs = Date.now();
  // The account_created event fires in the same second the account row is
  // written (client beacon right after the signup/confirm response), so the
  // closest event within ±5 minutes is the signup's own event. Events with no
  // user anywhere near (QA retries, failed signups) attach to nothing.
  const evList = acEvents.map((e: any) => ({ ts: new Date(e.ts).getTime(), vid: e.vid, meta: e.meta && typeof e.meta === "object" ? e.meta : {} }));
  const MAX_JOIN_MS = 5 * 60000;
  const nearestEvent = (createdMs: number): any | null => {
    let best: any = null;
    let bestD = Infinity;
    for (const e of evList) {
      const d = Math.abs(e.ts - createdMs);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best && bestD <= MAX_JOIN_MS ? best : null;
  };
  const rows = usersAll
    .map((u: any) => {
      const profile = u.profile && typeof u.profile === "object" ? u.profile : {};
      const createdMs = new Date(u.createdAt).getTime();
      const ev = nearestEvent(createdMs);
      const sess = ev ? sessByVid.get(ev.vid) : null;
      const meta = ev ? ev.meta : {};
      const sourceRaw = typeof meta.source === "string" && meta.source ? String(meta.source) : sess?.source ? String(sess.source) : "";
      const source = customersSourceKind(sourceRaw);
      const campaign = (typeof meta.campaign === "string" && meta.campaign ? String(meta.campaign) : "") || (sess?.campaign ? String(sess.campaign) : "");
      const landing = customersPathOnly(sess?.landingPath) || customersPathOnly(meta.path) || customersPathOnly(sess?.entryPath) || "";
      const storedTier = typeof profile.tier === "string" ? String(profile.tier) : "";
      const tier = storedTier && storedTier !== "free" ? storedTier : "free";
      // Paid = a real paid plan on the account (stored tier, or a renewsAt marker
      // from a paid subscription). A live 24h trial is NOT paid.
      const paid = (!!storedTier && storedTier !== "free") || !!profile.tierRenewsAt;
      const trialRow = trials.find((t: any) => t.userId === u.id);
      const trial = trialRow ? (new Date(trialRow.expiresAt).getTime() > nowMs ? "active" : "used") : "none";
      return {
        email: String(u.email || ""),
        created: u.createdAt,
        confirmed: !!u.confirmedAt,
        source,
        sourceLabel: CUSTOMERS_SOURCE_LABELS[source] || "Other",
        campaign,
        landing,
        tier,
        tierLabel: CUSTOMERS_TIER_LABELS[tier] || tier,
        trial,
        paid,
        createdToday: createdMs >= dayMs,
      };
    })
    .sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime());
  const signupsToday = rows.filter((r: any) => r.createdToday).length;
  const signupsTotal = rows.length;
  const paidToday = rows.filter((r: any) => r.createdToday && r.paid).length;
  const paidTotal = rows.filter((r: any) => r.paid).length;
  const countSince = (list: any[], fromMs: number) => (list || []).filter((e: any) => new Date(e.ts).getTime() >= fromMs).length;
  const reviewsToday = countSince(data?.reviewEvents, dayMs);
  const reviewsTotal = (data?.reviewEvents || []).length;
  const checkoutsToday = countSince(data?.checkoutEvents, dayMs);
  const checkoutsTotal = (data?.checkoutEvents || []).length;
  const sourceSplit = ["google", "tiktok", "direct", "other"].map((src) => ({ source: src, label: CUSTOMERS_SOURCE_LABELS[src] || "Other", count: rows.filter((r: any) => r.source === src).length }));
  const attributedToday = rows.filter((r: any) => r.createdToday);
  const base = attributedToday.length;
  const funnel = ["google", "tiktok", "direct"].map((src) => {
    const sig = attributedToday.filter((r: any) => r.source === src);
    return { source: src, label: CUSTOMERS_SOURCE_LABELS[src] || "Other", signups: sig.length, paid: sig.filter((r: any) => r.paid).length, base, sampleTooSmall: base < CUSTOMERS_MIN_SAMPLE };
  });
  return json3(
    { rows, counts: { signupsToday, signupsTotal, paidToday, paidTotal, reviewsToday, reviewsTotal, checkoutsToday, checkoutsTotal }, sourceSplit, funnel, minSample: CUSTOMERS_MIN_SAMPLE },
    200,
    { "Cache-Control": "no-store" }
  );
}
// Per-visitor drill-down for the owner dashboard's live panel: one vid's last 50
// events (name/ts/path/plan) plus the Metrics 2.0 session-play replay timeline
// (most recent 200 rows, oldest first — page enter/exit, scroll samples, and
// every event with client-derived dt/t durations). Behind the EXACT same owner
// gate as handleMetrics — a non-owner or unsigned-in request gets a 404, never
// data.
async function handleVisitor(req: Request) {
  const owner = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!owner) return json3({ error: "Not available" }, 404);
  const session = getSession(req);
  if (!session) return json3({ error: "Not available" }, 404);
  const users = await readUsers();
  const user = users.find((u:any) => u.id === session.userId);
  if (!user || String(user.email).toLowerCase() !== owner) return json3({ error: "Not available" }, 404);
  const vid = new URL(req.url).searchParams.get("vid") || "";
  if (!vid || vid.length > 100) return json3({ error: "Invalid visitor id." }, 400);
  const [events, play] = await Promise.all([eventsForVid(vid), sessionPlayForVisitor(vid)]);
  return json3({ vid, events, play }, 200, { "Cache-Control": "no-store" });
}
// Owner-only metrics reset (owner 2026-08-13): wipes the four analytics tables
// (events, sessions, session play, anonymous usage counters) so the owner can
// start the board clean anytime. Same gate as handleMetrics — a non-owner or
// unsigned-in request gets a 404, never a wipe. Never touches users/auth/
// reviews/money tables.
async function handleMetricsReset(req: Request) {
  const owner = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!owner) return json3({ error: "Not available" }, 404);
  const session = getSession(req);
  if (!session) return json3({ error: "Not available" }, 404);
  const users = await readUsers();
  const user = users.find((u:any) => u.id === session.userId);
  if (!user || String(user.email).toLowerCase() !== owner) return json3({ error: "Not available" }, 404);
  const wiped = await clearMetrics();
  return json3({ ok: true, wiped, at: new Date().toISOString() }, 200, { "Cache-Control": "no-store" });
}
// ---- TikTok Content Posting integration ------------------------------------
// OAuth code exchange + refresh (same endpoint, different grant_type) and
// Direct Post publish (PULL_FROM_URL). Tokens live ONLY in bys_tiktok_tokens
// (server-side); the API surface below never returns a token to a client.
// Publish NEVER fires automatically — POST /api/tiktok/publish is owner-only.
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_PUBLISH_URL = "https://open.tiktokapis.com/v2/post/publish/";
// Must match a registered redirect URI in the TikTok developer portal
// (Login Kit → URL properties). Also the redirect_uri param in the OAuth link.
const TIKTOK_REDIRECT_URI = "https://beforeyousend.org/api/tiktok/callback";
const TIKTOK_REFRESH_BUFFER_MS = 5 * 60 * 1000; // self-heal 5 min before expiry

function tiktokCreds() {
  return { key: process.env.TIKTOK_CLIENT_KEY || "", secret: process.env.TIKTOK_CLIENT_SECRET || "" };
}
async function tiktokTokenCall(params) {
  try {
    const res = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.warn("[tiktok] token call failed:", err);
    return { ok: false, status: 0, data: { error: String(err) } };
  }
}
async function tiktokExchangeCode(code) {
  const c = tiktokCreds();
  return tiktokTokenCall({ client_key: c.key, client_secret: c.secret, code, grant_type: "authorization_code", redirect_uri: TIKTOK_REDIRECT_URI });
}
async function tiktokRefresh(refreshToken) {
  const c = tiktokCreds();
  return tiktokTokenCall({ client_key: c.key, client_secret: c.secret, refresh_token: refreshToken, grant_type: "refresh_token" });
}
// Returns a usable access token, refreshing when near expiry. null = not connected.
async function tiktokValidToken() {
  const row = await readTikTokToken();
  if (!row || !row.accessToken) return null;
  const now = Date.now();
  if (!row.expiresAt || row.expiresAt - now > TIKTOK_REFRESH_BUFFER_MS) return row.accessToken;
  if (!row.refreshToken) return null;
  const r = await tiktokRefresh(row.refreshToken);
  if (!r.ok || !r.data || !r.data.access_token) {
    console.warn("[tiktok] refresh failed:", r.status, JSON.stringify(r.data).slice(0, 300));
    return null;
  }
  await upsertTikTokToken({
    accessToken: String(r.data.access_token),
    refreshToken: r.data.refresh_token ? String(r.data.refresh_token) : row.refreshToken,
    openId: r.data.open_id ? String(r.data.open_id) : row.openId,
    scope: r.data.scope ? String(r.data.scope) : row.scope,
    expiresAt: now + Number(r.data.expires_in || 86400) * 1000,
  });
  return String(r.data.access_token);
}
// GET /api/tiktok/callback?code=...&state=... — OAuth redirect target.
// Exchanges the code, stores tokens (single-row upsert), 302s to the friendly
// connected page. On any failure it still 302s to the page with ?ok=0 — the
// plain, factual "not connected" state — never a raw error dump.
async function handleTikTokCallback(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const errParam = url.searchParams.get("error") || "";
  const base = "https://beforeyousend.org/tiktok-connected";
  if (errParam || !code) {
    console.warn("[tiktok] callback error:", errParam || "missing code", "state:", state ? "present" : "missing");
    return Response.redirect(`${base}?ok=0`, 302);
  }
  const r = await tiktokExchangeCode(code);
  if (!r.ok || !r.data || !r.data.access_token) {
    console.warn("[tiktok] code exchange failed:", r.status, JSON.stringify(r.data).slice(0, 300));
    return Response.redirect(`${base}?ok=0`, 302);
  }
  await upsertTikTokToken({
    accessToken: String(r.data.access_token),
    refreshToken: r.data.refresh_token ? String(r.data.refresh_token) : null,
    openId: r.data.open_id ? String(r.data.open_id) : null,
    scope: r.data.scope ? String(r.data.scope) : null,
    expiresAt: Date.now() + Number(r.data.expires_in || 86400) * 1000,
  });
  return Response.redirect(`${base}?ok=1`, 302);
}
// GET /api/tiktok/status — { connected, open_id, last_publish }. Public and
// token-free by design (nothing sensitive leaks; tokens never leave the server).
async function handleTikTokStatus() {
  try {
    const row = await readTikTokToken();
    const pubs = await readTikTokPublishes(1);
    return json3({
      connected: !!(row && row.accessToken),
      open_id: (row && row.openId) || null,
      last_publish: pubs && pubs.length ? {
        publish_id: pubs[0].publishId || null,
        status: pubs[0].status || null,
        created_at: pubs[0].createdAt ? String(pubs[0].createdAt) : null,
      } : null,
    }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.warn("[tiktok] status failed:", err);
    return json3({ connected: false, open_id: null, last_publish: null, error: "status unavailable" }, 500, { "Cache-Control": "no-store" });
  }
}
// POST /api/tiktok/publish { videoUrl, caption } — owner-only. Publishes via
// Direct Post PULL_FROM_URL. Never called automatically; explicit call only.
async function handleTikTokPublish(req) {
  const s = getSession(req);
  if (!s) return json3({ error: "Sign in required." }, 401);
  const users = await readUsers();
  const u = users.find((x2) => x2.id === s.userId);
  const owner = String(process.env.OWNER_EMAIL || "").toLowerCase();
  if (!u || String(u.email).toLowerCase() !== owner) return json3({ error: "Not available." }, 404);
  let body;
  try { body = await req.json(); } catch { return json3({ error: "Invalid request." }, 400); }
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 2200) : "";
  if (!videoUrl) return json3({ error: "videoUrl is required." }, 400);
  let u2;
  try { u2 = new URL(videoUrl); } catch { return json3({ error: "videoUrl must be a valid https URL." }, 400); }
  const ourHost = u2.hostname === "beforeyousend.org" || u2.hostname === "www.beforeyousend.org" || u2.hostname.endsWith(".beforeyousend.org") || u2.hostname.endsWith(".vercel.app");
  if (u2.protocol !== "https:" || !ourHost) return json3({ error: "videoUrl must be an https URL on our own domain." }, 400);
  const token = await tiktokValidToken();
  if (!token) return json3({ error: "TikTok is not connected yet." }, 400);
  let res;
  try {
    res = await fetch(TIKTOK_PUBLISH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        post_info: { title: caption, privacy_level: "SELF_ONLY" },
        source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    console.warn("[tiktok] publish call failed:", err);
    return json3({ error: "TikTok publish request failed." }, 502);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  const publishId = data && data.data && data.data.publish_id ? String(data.data.publish_id) : null;
  const pubStatus = res.ok ? (data && data.data && data.data.status ? String(data.data.status) : "processing") : "error";
  await addTikTokPublish({ publishId, videoUrl, caption, status: pubStatus, apiStatus: res.ok ? String(res.status) : `error:${res.status}` });
  if (!res.ok) {
    console.warn("[tiktok] publish rejected:", res.status, JSON.stringify(data).slice(0, 300));
    return json3({ error: "TikTok rejected the publish.", detail: data && (data.error || data.raw) ? String(data.error || data.raw).slice(0, 300) : "unknown" }, 502);
  }
  return json3({ ok: true, publish_id: publishId, status: pubStatus }, 201);
}
// ---- Record Review (one-time $29.50 + Ultimate 1/year — Stage 2, 2026-08-13)
// GET  /api/record-review — re-view the account's LATEST generated report
//   (works even after an Ultimate allowance is spent — the report is his own;
//   re-viewing never regenerates). Session-gated; returns { report|null }.
// POST /api/record-review — generate a NEW report. Entitlement-gated (Stage 1
//   recordReviewEntitlement): the purchased grant is permanent (unlimited
//   regenerations); Ultimate redeems the 1/year allowance ONLY when a report is
//   actually generated — the kind='redemption' insert IS the Stage 1 hook, and
//   it is rolled back if persisting the report fails so a failed generate never
//   silently burns the allowance. Sections are deterministic from the dad's own
//   record (always complete); LLM polish rides on top when the provider is
//   healthy. The report persists on the anchor bys_record_reviews row.
var RECORD_REVIEW_402 = "Record Review is a one-time purchase, or included once a year with Ultimate.";
async function handleRecordReview(req, method) {
  var s = getSession(req);
  if (!s) return json3({ error: "Sign in to your account to run a Record Review." }, 401);
  var users = await readUsers(), u = users.find(function (x) { return x.id === s.userId; });
  if (!u) return json3({ error: "Account not found." }, 404);
  if (method === "GET") {
    var latest = null;
    try { latest = await latestRecordReviewReport(u.id); } catch (err) { console.warn("[record-review] latest read failed:", err); }
    return json3({ report: latest && latest.reportHtml ? { html: latest.reportHtml, generatedAt: latest.reportGeneratedAt, fallback: !!latest.reportFallback } : null });
  }
  var tier0 = userTier(u);
  addEvent({ vid: visitorVid(req) || "server", name: "record_review_started", plan: tier0 }).catch(function (err) { console.warn("[record-review] event failed:", err); });
  var ent = await recordReviewEntitlement(u);
  if (!ent.entitled) {
    var msg = ent.nextAvailableAt
      ? "Your one Record Review for this year is already used. You can buy another, or the allowance resets " + expDate(ent.nextAvailableAt) + "."
      : RECORD_REVIEW_402;
    return json3({ error: msg, nextAvailableAt: ent.nextAvailableAt || null }, 402);
  }
  var reviews, log, timeline, files, cs;
  try {
    reviews = (await readReviewsForUser(u.id)).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    log = await readLogForUser(u.id);
    timeline = await readTimelineForUser(u.id);
    files = await readOrganizerFilesMeta(u.id);
    cs = await readCaseSummary(u.id);
  } catch (err) {
    console.warn("[record-review] record gather failed:", err);
    return json3({ error: "We couldn't read your record right now — give it a minute and try again." }, 502);
  }
  var built;
  try {
    built = await buildRecordReview({ user: u, reviews: reviews, log: log, timeline: timeline, files: files, caseSummary: cs }, llm);
  } catch (err) {
    console.warn("[record-review] build failed:", err);
    addEvent({ vid: visitorVid(req) || "server", name: "record_review_failed", plan: tier0 }).catch(function () {});
    return json3({ error: "We couldn't prepare your Record Review right now — please try again in a minute." }, 500);
  }
  // Anchor + persist: purchased → the purchase row; ultimate → a NEW redemption
  // row (the Stage 1 hook — consumed only now that a report generated).
  var anchorSession = null, createdRedemption = false;
  try {
    if (ent.kind === "purchased") {
      var rows = await recordReviewsForUser(u.id);
      var purchaseRow = rows.find(function (r) { return r.kind === "purchase"; });
      anchorSession = purchaseRow && purchaseRow.sessionId ? purchaseRow.sessionId : null;
      if (!anchorSession) {
        // Stamp-only purchase (the durable insert failed at confirm): mint the
        // anchor row now so the report persists and the grant becomes durable
        // (same token scheme as the redemption branch).
        var pToken = "rr-" + String(u.id).slice(0, 8) + "-" + crypto.randomUUID();
        var pRow = await insertRecordReview({ userId: u.id, email: u.email, kind: "purchase", amountCents: 0, sessionId: pToken });
        anchorSession = pRow && pRow.sessionId ? pRow.sessionId : pToken;
      }
    } else {
      var token = "rr-" + String(u.id).slice(0, 8) + "-" + crypto.randomUUID();
      var red = await insertRecordReview({ userId: u.id, email: u.email, kind: "redemption", amountCents: 0, sessionId: token });
      anchorSession = red && red.sessionId ? red.sessionId : token;
      createdRedemption = true;
    }
    if (anchorSession) await saveRecordReviewReport(anchorSession, built.html, built.fallback);
  } catch (err) {
    console.warn("[record-review] persist failed:", err);
    if (createdRedemption && anchorSession) {
      try { await deleteRecordReviewBySession(anchorSession); } catch (err2) { console.warn("[record-review] rollback failed:", err2); }
    }
    addEvent({ vid: visitorVid(req) || "server", name: "record_review_failed", plan: tier0 }).catch(function () {});
    return json3({ error: "We couldn't save your Record Review right now — please try again in a minute." }, 500);
  }
  addEvent({ vid: visitorVid(req) || "server", name: "record_review_generated", plan: tier0, meta: { fallback: built.fallback } }).catch(function (err) { console.warn("[record-review] event failed:", err); });
  var ent2 = await recordReviewEntitlement(u).catch(function () { return ent; });
  return json3({ ok: true, report: { html: built.html, generatedAt: built.generatedAt, fallback: built.fallback }, entitlement: ent2 });
}
export async function handleApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url), { pathname } = url, method = req.method;
  // Hydrate the in-memory session cache from the durable DB first, so a login
  // made on another (now recycled) instance still authenticates here.
  await warmSession(req);
  const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)bys_vid=([^;]+)/)?.[1];
  // Conversion-tracking Fix 2 (audit 85fbc48d): NO blanket session upsert for
  // /api/* requests — bys_sessions rows are created only from genuine page_view
  // events (handleEvents below) with the true landing path + document.referrer,
  // so entry_path is never "/api/events" and pageviews counts page views only.
  if (pathname === "/api/events" && method === "POST")
    return handleEvents(req);
  if (pathname === "/api/metrics/summary" && method === "GET")
    return handleMetrics(req);
  if (pathname === "/api/metrics/customers" && method === "GET")
    return handleCustomers(req);
  if (pathname === "/api/metrics/visitor" && method === "GET")
    return handleVisitor(req);
  if (pathname === "/api/metrics/reset" && method === "POST")
    return handleMetricsReset(req);
  if (pathname === "/api/portal" && method === "POST")
    return handlePortal(req);
  if (pathname === "/api/account" && method === "DELETE")
    return handleAccountDelete(req);
  if (pathname === "/api/checkout" && method === "POST")
    return handleCheckout(req);
  if (pathname === "/api/checkout/confirm" && method === "POST")
    return handleCheckoutConfirm(req);
  if (pathname === "/api/stripe/webhook" && method === "POST")
    return handleStripeWebhook(req);
  if (pathname === "/api/review" && method === "POST")
    return handleReview(req);
  if (pathname === "/api/analyze" && method === "POST")
    return handleAnalyze(req);
  if (pathname === "/api/save" && method === "POST")
    return handleSave(req);
  if (pathname === "/api/signup-remove" && method === "POST")
    return handleSignupRemove(req);
  if (pathname === "/api/auth/confirm-link" && method === "POST")
    return handleConfirmLink(req);
  if (pathname === "/api/auth/confirm" && method === "POST")
    return handleConfirm(req);
  if (pathname === "/api/auth/password" && method === "POST")
    return handlePassword(req);
  if (pathname === "/api/auth/login" && method === "POST")
    return handleLogin(req);
  if (pathname === "/api/auth/signup" && method === "POST")
    return handleSignup(req);
  if (pathname === "/api/auth/logout" && method === "POST")
    return authLogout(req);
  if (pathname === "/api/auth/me" && method === "GET")
    return authMe(req);
  if (pathname === "/api/trial/start" && method === "POST")
    return handleTrialStart(req);
  if (pathname === "/api/auth/profile" && method === "POST")
    return handleProfile(req);
  if (pathname === "/api/reviews" && (method === "GET" || method === "POST" || method === "DELETE" || method === "PATCH"))
    return handleReviews(req, method);
  if (pathname === "/api/log" && (method === "GET" || method === "POST"))
    return handleLog(req, method);
  const m2 = pathname.match(/^\/api\/log\/([^/]+)$/);
  if (m2 && (method === "PATCH" || method === "PUT" || method === "DELETE"))
    return handleLog(req, method, m2[1]);
  if (pathname === "/api/review-events" && (method === "GET" || method === "POST"))
    return handleReviewEvents(req, method);
  if (pathname === "/api/digest" && method === "GET")
    return handleDigest(req);
  if (pathname === "/api/gifts" && method === "POST")
    return handleGiftPurchase(req);
  if (pathname === "/api/gifts/my" && method === "GET")
    return handleGiftCodes(req);
  if (pathname === "/api/gifts/redeem" && method === "POST")
    return handleGiftRedeem(req);
  if (pathname === "/api/gifts/status" && method === "GET")
    return handleGiftStatus(req);
  const revM = pathname.match(/^\/api\/review-events\/([^/]+)$/);
  if (revM && method === "PATCH")
    return handleReviewEvents(req, method, revM[1]);
  if (pathname === "/api/timeline" && (method === "GET" || method === "POST"))
    return handleTimeline(req, method);
  const tm = pathname.match(/^\/api\/timeline\/([^/]+)$/);
  if (tm && (method === "PATCH" || method === "PUT" || method === "DELETE"))
    return handleTimeline(req, method, tm[1]);
  if (pathname === "/api/organizer/trial" && method === "POST")
    return handleOrganizerTrial(req);
  if (pathname === "/api/organizer/files" && (method === "GET" || method === "POST"))
    return handleOrganizerFiles(req, method);
  const ofm = pathname.match(/^\/api\/organizer\/files\/([^/]+)$/);
  if (ofm && (method === "DELETE" || method === "PATCH"))
    return handleOrganizerFiles(req, method, ofm[1]);
  if (pathname === "/api/organizer/sort" && method === "POST")
    return handleSortPileCreate(req);
  const sm = pathname.match(/^\/api\/organizer\/sort\/([^/]+)$/);
  if (sm && method === "GET")
    return handleSortPilePoll(req, sm[1]);
  if (pathname === "/api/case-summary" && (method === "GET" || method === "POST"))
    return handleCaseSummary(req, method);
  if (pathname === "/api/record-health" && method === "GET")
    return handleRecordHealth(req);
  if (pathname === "/api/action-center" && (method === "GET" || method === "POST"))
    return handleActionCenter(req, method);
  if (pathname === "/api/export" && method === "GET")
    return handleExport(req);
  if (pathname === "/api/attorney-pack" && method === "GET")
    return handleAttorneyPack(req);
  if (pathname === "/api/tiktok/callback" && method === "GET")
    return handleTikTokCallback(req);
  if (pathname === "/api/tiktok/status" && method === "GET")
    return handleTikTokStatus();
  if (pathname === "/api/tiktok/publish" && method === "POST")
    return handleTikTokPublish(req);
  if (pathname === "/api/record-review" && (method === "GET" || method === "POST"))
    return handleRecordReview(req, method);
  return null;
}

