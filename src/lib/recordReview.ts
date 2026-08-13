// Record Review — Stage 2 DELIVERABLE (2026-08-13).
// Server-side assembly of a calm, thorough Record Review report from the dad's
// OWN saved record, with exactly these sections:
//   (a) overview — what the record shows at a glance (counts, date span)
//   (b) communication patterns — deterministic from log tones (TONE_DISPLAY) +
//       saved-review impact scores (computeImpactScore): tone mix, response
//       cadence, escalation signals, how often messages went through a calm
//       review vs sent as written
//   (c) evidence strengths — what is well documented (organizer docs with
//       folder/tags, dated entries) and where the record is thin
//   (d) risks in the record — escalation flags / conflict signals grounded
//       ONLY in actual entries
//   (e) what to document next — concrete, grounded in the identified gaps
//   (f) honest footer "Not legal advice."
// LLM-polished when the provider is healthy (DeepSeek-V3.2 via SambaNova,
// bounded excerpt, ~45s abort); FULLY deterministic always — a complete,
// honest report generates even with the LLM down. Every line traces to actual
// saved data or is clearly generic guidance; nothing is invented.
//
// The report HTML is self-contained (inline CSS, no external assets) so the
// same string serves the in-app view (iframe srcDoc) and the download.

import { computeImpactScore } from "./impactScore";
import { TONE_DISPLAY } from "./toneLabels";

export type RecordReviewLLM = { base: string; key: string; model: string } | null;

export type RecordReviewInput = {
  user: any;
  reviews: any[];
  log: any[];
  timeline: any[];
  files: any[];
  caseSummary: any | null;
};

export type RecordReviewResult = {
  html: string;
  filename: string;
  fallback: boolean;
  generatedAt: string; // ISO
};

const RR_MAX_EXCERPT_CHARS = 24000;
const RR_MAX_SECTION_CHARS = 1800;

const RR_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rrEsc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// "YYYY-MM-DD" (or any ISO date) -> "May 14, 2026"; anything else passes through.
function rrDate(d: unknown): string {
  if (!d) return "";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  return RR_MONTHS[(Number(m[2]) - 1 + 12) % 12] + " " + Number(m[3]) + ", " + m[1];
}

// Day key ("YYYY-MM-DD") -> epoch ms at local midnight (NaN when unparsable).
function rrDay(d: unknown): number {
  const m = String(d == null ? "" : d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return NaN;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(dt.getTime()) ? NaN : dt.getTime();
}

function rrOneLine(s: unknown, n: number): string {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function rrTitleCase(s: string): string {
  return s.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function median(nums: number[]): number {
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export type RRGap = { from: string; to: string; days: number };

export type RRFindings = {
  total: number;
  counts: { log: number; timeline: number; files: number; reviews: number };
  datedLog: number;
  datedTimeline: number;
  span: { earliest: string; latest: string } | null; // 'YYYY-MM-DD' day keys
  spanDays: number | null;
  toneMix: { label: string; n: number }[];
  asWrote: number;
  reviewedLogs: number;
  cadence: { median: number | null; pairs: number };
  reviewScores: number[];
  flaggedReviews: number;
  flaggedReviewNotes: string[];
  docs: { withFolder: number; withSummary: number; withTags: number; folders: { label: string; n: number }[] };
  gaps: RRGap[]; // top 5, days > 3, from dated log+timeline
  undated: { log: number; timeline: number };
  topics: { label: string; n: number }[];
  cats: { label: string; n: number }[];
  hasCaseSummary: boolean;
};

// ---- Deterministic analysis (pure — no IO, no LLM) -------------------------
export function analyzeRecord(input: RecordReviewInput): RRFindings {
  const log = Array.isArray(input.log) ? input.log : [];
  const timeline = Array.isArray(input.timeline) ? input.timeline : [];
  const files = Array.isArray(input.files) ? input.files : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];

  const datedLog = log.filter((l: any) => Number.isFinite(rrDay(l?.date))).length;
  const datedTimeline = timeline.filter((t: any) => Number.isFinite(rrDay(t?.date))).length;

  // Date span across log dates, timeline dates, file createdAt, review createdAt.
  let earliest = "";
  let latest = "";
  const consider = (d: unknown) => {
    const k = String(d == null ? "" : d).slice(0, 10);
    const day = rrDay(k);
    if (!Number.isFinite(day)) return;
    if (!earliest || k < earliest) earliest = k;
    if (!latest || k > latest) latest = k;
  };
  log.forEach((l: any) => consider(l?.date));
  timeline.forEach((t: any) => consider(t?.date));
  files.forEach((f: any) => consider(f?.createdAt));
  reviews.forEach((r: any) => consider(r?.createdAt));
  const span = earliest && latest ? { earliest, latest } : null;
  const spanDays = span ? Math.max(1, Math.round((rrDay(span.latest) - rrDay(span.earliest)) / 86400000) + 1) : null;

  // Tone mix (TONE_DISPLAY labels).
  const toneCounts: Record<string, number> = {};
  log.forEach((l: any) => {
    const t = l?.tone;
    if (t && TONE_DISPLAY[t]) toneCounts[t] = (toneCounts[t] || 0) + 1;
  });
  const toneMix = Object.keys(toneCounts)
    .sort((a, b) => toneCounts[b] - toneCounts[a])
    .map((t) => ({ label: TONE_DISPLAY[t], n: toneCounts[t] }));
  const asWrote = toneCounts["as-wrote"] || 0;
  const reviewedLogs = toneCounts["reviewed"] || 0;

  // Response cadence: dated received -> next dated sent pair, median days (≤60).
  const dated = log
    .map((l: any) => ({ day: rrDay(l?.date), dir: l?.direction }))
    .filter((x: any) => Number.isFinite(x.day))
    .sort((a: any, b: any) => a.day - b.day);
  const gaps: number[] = [];
  for (let i = 0; i < dated.length; i++) {
    if (dated[i].dir !== "received") continue;
    for (let j = i + 1; j < dated.length; j++) {
      if (dated[j].dir === "sent") {
        const g = Math.round((dated[j].day - dated[i].day) / 86400000);
        if (g >= 0 && g <= 60) gaps.push(g);
        break;
      }
    }
  }
  const cadence = { median: gaps.length ? median(gaps) : null, pairs: gaps.length };

  // Saved reviews: impact scores + conflict flags (risks/watchout items).
  const reviewScores: number[] = [];
  const flaggedReviewNotes: string[] = [];
  let flaggedReviews = 0;
  reviews.forEach((r: any) => {
    const s = computeImpactScore(Array.isArray(r?.blocks) ? r.blocks : []);
    reviewScores.push(s.score);
    if (s.flags.risks > 0 || s.flags.watchout > 0) {
      flaggedReviews++;
      const when = r?.createdAt ? rrDate(r.createdAt) : "";
      const bits: string[] = [];
      if (s.flags.risks > 0) bits.push(s.flags.risks + (s.flags.risks === 1 ? " conflict risk" : " conflict risks"));
      if (s.flags.watchout > 0) bits.push(s.flags.watchout + (s.flags.watchout === 1 ? " caution flag" : " caution flags"));
      flaggedReviewNotes.push((when ? when + ": " : "") + "a saved review flagged " + bits.join(" and ") + " (score " + s.score + "/100).");
    }
  });

  // Organizer documents: how well organized.
  const docFolders: Record<string, number> = {};
  files.forEach((f: any) => {
    const folder = String(f?.folder || "other").replace(/-/g, " ").trim();
    docFolders[folder || "other"] = (docFolders[folder || "other"] || 0) + 1;
  });
  const docs = {
    withFolder: files.filter((f: any) => !!f?.folder).length,
    withSummary: files.filter((f: any) => !!f?.summary).length,
    withTags: files.filter((f: any) => Array.isArray(f?.tags) && f.tags.length > 0).length,
    folders: Object.keys(docFolders).sort().map((k) => ({ label: rrTitleCase(k), n: docFolders[k] })),
  };

  // Coverage gaps: merged dated log+timeline, gaps > 3 days, top 5 by size.
  const datedItems = [
    ...log.filter((l: any) => Number.isFinite(rrDay(l?.date))).map((l: any) => ({ day: rrDay(l.date), key: String(l.date).slice(0, 10) })),
    ...timeline.filter((t: any) => Number.isFinite(rrDay(t?.date))).map((t: any) => ({ day: rrDay(t.date), key: String(t.date).slice(0, 10) })),
  ].sort((a, b) => a.day - b.day);
  const gapList: RRGap[] = [];
  for (let i = 1; i < datedItems.length; i++) {
    const d = Math.round((datedItems[i].day - datedItems[i - 1].day) / 86400000);
    if (d > 3) gapList.push({ from: datedItems[i - 1].key, to: datedItems[i].key, days: d });
  }
  gapList.sort((a, b) => b.days - a.days);

  const topicCounts: Record<string, number> = {};
  log.forEach((l: any) => {
    const t = l?.topic || "other";
    topicCounts[t] = (topicCounts[t] || 0) + 1;
  });
  const catCounts: Record<string, number> = {};
  timeline.forEach((t: any) => {
    const c = t?.category || "other";
    catCounts[c] = (catCounts[c] || 0) + 1;
  });

  return {
    total: log.length + timeline.length + files.length + reviews.length,
    counts: { log: log.length, timeline: timeline.length, files: files.length, reviews: reviews.length },
    datedLog,
    datedTimeline,
    span,
    spanDays,
    toneMix,
    asWrote,
    reviewedLogs,
    cadence,
    reviewScores,
    flaggedReviews,
    flaggedReviewNotes,
    docs,
    gaps: gapList.slice(0, 5),
    undated: { log: log.length - datedLog, timeline: timeline.length - datedTimeline },
    topics: Object.keys(topicCounts).sort().map((t) => ({ label: rrTitleCase(String(t).replace(/-/g, " ")), n: topicCounts[t] })),
    cats: Object.keys(catCounts).sort().map((c) => ({ label: rrTitleCase(String(c).replace(/-/g, " ")), n: catCounts[c] })),
    hasCaseSummary: !!(input.caseSummary && (input.caseSummary as any).text),
  };
}

// ---- Deterministic section prose (always available, honest "quick version") -
function detOverview(f: RRFindings): string {
  const c = f.counts;
  const parts: string[] = [];
  if (f.total === 0) {
    return "Nothing is saved in your record yet. Add a log entry, a timeline event, or a document and this review will build from them — every finding below comes from your own saved entries, never from guesses.";
  }
  const bits: string[] = [];
  if (c.log) bits.push(c.log + (c.log === 1 ? " log entry" : " log entries"));
  if (c.timeline) bits.push(c.timeline + (c.timeline === 1 ? " timeline event" : " timeline events"));
  if (c.files) bits.push(c.files + (c.files === 1 ? " organizer document" : " organizer documents"));
  if (c.reviews) bits.push(c.reviews + (c.reviews === 1 ? " saved review" : " saved reviews"));
  parts.push("Your record holds " + bits.join(", ") + ".");
  if (f.span) {
    parts.push("The earliest dated entry is " + rrDate(f.span.earliest) + " and the latest is " + rrDate(f.span.latest) + " — a span of " + f.spanDays + (f.spanDays === 1 ? " day." : " days."));
  } else {
    parts.push("None of the entries carry dates yet — adding dates will show the record's span here.");
  }
  parts.push("The review engine is briefly busy, so this is the quick version — every finding below comes straight from your saved record.");
  return parts.join("\n");
}

function detPatterns(f: RRFindings): string {
  const c = f.counts;
  const parts: string[] = [];
  if (!c.log && !c.reviews) {
    return "No log entries or saved reviews yet — communication patterns will build as you log messages and save reviews.";
  }
  const sent = 0; // placeholder to keep ordering readable
  void sent;
  if (c.log) {
    if (f.toneMix.length) {
      parts.push("Tone mix across logged messages: " + f.toneMix.map((t) => t.label + " " + t.n).join(" · ") + ".");
    } else {
      parts.push("Logged messages don't have tone markers yet — they appear when a message is logged through the did-you-send loop or given a tone manually.");
    }
    if (f.cadence.pairs >= 2) {
      parts.push("Median response time to co-parent messages: " + f.cadence.median + (f.cadence.median === 1 ? " day" : " days") + ", measured from " + f.cadence.pairs + " dated exchange" + (f.cadence.pairs === 1 ? "" : "s") + ".");
    } else if (f.cadence.pairs === 1) {
      parts.push("Not enough dated exchanges to measure a response pattern yet — keep logging and it will show up here.");
    } else {
      parts.push("Not enough dated exchanges to measure response time yet.");
    }
    const esc: string[] = [];
    if (f.asWrote > 0) esc.push(f.asWrote + (f.asWrote === 1 ? " message was sent as originally written — no calm pass." : " messages were sent as originally written — no calm pass."));
    if (f.reviewedLogs > 0) esc.push(f.reviewedLogs + (f.reviewedLogs === 1 ? " message was run through a calm review before sending." : " messages were run through a calm review before sending."));
    if (esc.length) parts.push("Escalation signals in the log: " + esc.join(" "));
    if (f.asWrote === 0 && f.reviewedLogs === 0) {
      parts.push("No messages are logged as sent as-written — the log has no escalation flags from the did-you-send loop.");
    }
  }
  if (c.reviews) {
    const avg = Math.round(f.reviewScores.reduce((a, b) => a + b, 0) / f.reviewScores.length);
    parts.push(f.reviewScores.length + (f.reviewScores.length === 1 ? " saved review" : " saved reviews") + " with an average Message Impact Score of " + avg + "/100 (tone and conflict signals only — not a prediction).");
    if (f.flaggedReviews > 0) {
      parts.push(f.flaggedReviews + (f.flaggedReviews === 1 ? " saved review flagged conflict signals" : " saved reviews flagged conflict signals") + ": " + f.flaggedReviewNotes.join(" "));
    } else {
      parts.push("No saved reviews carry conflict-signal flags.");
    }
  }
  return parts.join("\n");
}

function detStrengths(f: RRFindings): string {
  const c = f.counts;
  const parts: string[] = [];
  if (f.total === 0) {
    return "Nothing saved yet — strengths will appear as you log and file.";
  }
  const strong: string[] = [];
  if (f.span && f.spanDays && f.spanDays >= 14) strong.push("entries span " + f.spanDays + " days, " + rrDate(f.span.earliest) + " through " + rrDate(f.span.latest) + " — a dated record shows continuity.");
  else if (f.span && f.spanDays) strong.push("the record currently spans " + f.spanDays + (f.spanDays === 1 ? " day" : " days") + " — a short window so far.");
  if (f.datedLog > 0) strong.push(f.datedLog + (f.datedLog === 1 ? " log entry has a date" : " log entries have dates") + (c.log > f.datedLog ? " of " + c.log : ""));
  if (f.datedTimeline > 0) strong.push(f.datedTimeline + (f.datedTimeline === 1 ? " timeline event has a date" : " timeline events have dates") + (c.timeline > f.datedTimeline ? " of " + c.timeline : ""));
  if (f.docs.withFolder > 0) strong.push(f.docs.withFolder + (f.docs.withFolder === 1 ? " document is filed in a folder" : " documents are filed in folders") + (f.docs.folders.length ? " (" + f.docs.folders.map((x) => x.label + " " + x.n).join(", ") + ")" : ""));
  if (f.docs.withSummary > 0) strong.push(f.docs.withSummary + (f.docs.withSummary === 1 ? " document has a summary" : " documents have summaries"));
  if (f.docs.withTags > 0) strong.push(f.docs.withTags + (f.docs.withTags === 1 ? " document has tags" : " documents have tags"));
  if (c.reviews > 0) strong.push(c.reviews + (c.reviews === 1 ? " saved review" : " saved reviews") + " — evidence you tried to keep the exchange calm");
  if (f.hasCaseSummary) strong.push("a case summary is on file");
  parts.push(strong.length ? "What's well documented: " + strong.join("; ") + "." : "Nothing is well documented yet — the record is still thin.");
  // Thin areas (honest, grounded).
  const thin: string[] = [];
  if (f.undated.log > 0) thin.push(f.undated.log + (f.undated.log === 1 ? " log entry has no date" : " log entries have no dates"));
  if (f.undated.timeline > 0) thin.push(f.undated.timeline + (f.undated.timeline === 1 ? " timeline event has no date" : " timeline events have no dates"));
  if (c.files === 0) thin.push("no documents in the Organizer");
  if (c.reviews === 0) thin.push("no saved reviews");
  if (c.timeline === 0) thin.push("no timeline events");
  if (f.spanDays !== null && f.spanDays < 14) thin.push("the dated record covers less than two weeks");
  if (thin.length) parts.push("Where the record is thin: " + thin.join("; ") + ".");
  return parts.join("\n");
}

function detRisks(f: RRFindings): string {
  const parts: string[] = [];
  if (f.total === 0) {
    return "No risks to flag — the record is empty. Risks appear as entries accumulate.";
  }
  const flags: string[] = [];
  if (f.asWrote > 0) {
    flags.push(f.asWrote + (f.asWrote === 1 ? " message was sent as originally written" : " messages were sent as originally written") + " — no calm pass before sending, so the wording is exactly what was drafted in the moment.");
  }
  f.flaggedReviewNotes.forEach((n) => flags.push(n));
  if (f.undated.log > 0 || f.undated.timeline > 0) {
    flags.push((f.undated.log + f.undated.timeline) + (f.undated.log + f.undated.timeline === 1 ? " entry has no date" : " entries have no dates") + " — undated entries are hard to place in a review of the record.");
  }
  if (f.gaps.length) {
    const g = f.gaps[0];
    flags.push("a " + g.days + "-day gap with no dated entries between " + rrDate(g.from) + " and " + rrDate(g.to) + " — a reviewer may read a silent stretch as 'nothing happened'.");
  }
  parts.push(flags.length
    ? "Grounded in your actual entries: " + flags.join(" ")
    : "No escalation flags in the saved record — no messages logged as sent as-written, no saved reviews with conflict signals, and no undated or gappy entries that would read poorly.");
  parts.push("These are observations about the record itself, not a prediction of how anyone will read it.");
  return parts.join("\n");
}

function detNext(f: RRFindings): string {
  const c = f.counts;
  const parts: string[] = [];
  if (f.total === 0) {
    return "Start by logging the most recent exchange — who said what, when, and the outcome. Then add the key dates (court dates, exchanges, school events) to the Event Timeline, and file any messages or receipts that matter. Even a short note each week builds a usable record.";
  }
  const steps: string[] = [];
  f.gaps.forEach((g, i) => {
    if (i === 0) steps.push("no dated entries between " + rrDate(g.from) + " and " + rrDate(g.to) + " (" + g.days + " days) — log anything you remember from that stretch, even a short note with approximate dates.");
  });
  if (f.undated.log > 0) steps.push(f.undated.log + (f.undated.log === 1 ? " log entry has no date" : " log entries have no dates") + " — add dates so each entry can be placed in the record.");
  if (f.undated.timeline > 0) steps.push(f.undated.timeline + (f.undated.timeline === 1 ? " timeline event has no date" : " timeline events have no dates") + " — add dates to the timeline.");
  if (c.files === 0) steps.push("file key messages or receipts in the Organizer — a screenshot with a one-line description is enough to start.");
  if (c.reviews === 0) steps.push("before the next hard message, run it through the free message review and save it — it shows you tried to keep the exchange calm.");
  if (c.timeline === 0) steps.push("add the big dates — court dates, exchanges, school events — to the Event Timeline.");
  if (!steps.length) steps.push("keep logging as you go — the record builds value over time. Add this week's messages, receipts, and dates next.");
  parts.push(steps.map((s, i) => (i + 1) + ". " + s).join("\n"));
  parts.push("Each step is grounded in what's actually missing from your record — nothing here requires inventing anything.");
  return parts.join("\n");
}

// ---- LLM polish (bounded, 45s abort; failure -> deterministic) -------------
const RR_SYSTEM_PROMPT = `You are "Before You Send", a calm, practical organizing assistant for a father in a co-parenting or custody situation. Below you get (1) a compact set of findings computed from HIS OWN saved record, and (2) a bounded excerpt of that record.

Write a Record Review report with EXACTLY these five sections (plain text, "### " headers, nothing before the first header):

### OVERVIEW
What the record shows at a glance — counts and date span. Say so honestly when a source is empty.

### COMMUNICATION PATTERNS
Tone mix, response cadence, and escalation signals that are ACTUALLY in the findings (messages sent as written, reviews that flagged conflict signals). If the record is too thin, say so.

### EVIDENCE STRENGTHS
What is well documented (dated entries, filed documents, summaries, tags, saved reviews) and where the record is thin (missing dates, gaps, empty sources). Ground every point in the findings.

### RISKS IN THE RECORD
Anything that could read poorly if the record were reviewed — escalation flags, conflict signals, undated entries, silent gaps. Ground ONLY in the findings and excerpt. If nothing, say clearly that no flags appear.

### WHAT TO DOCUMENT NEXT
Concrete next steps grounded in the identified gaps (e.g. "no dated entries between May 20 and June 2 — log anything you remember from those dates"). If the record is complete, say keep logging.

RULES:
- Reference ONLY facts present in the findings or excerpt. Never invent names, dates, entries, documents, or patterns.
- NEVER give legal advice, never predict outcomes, never say what a judge or attorney would do or think.
- Stay calm, neutral, and brief — under 450 words total. No headers other than the five above, no bullets with symbols, plain sentences.`;

function parsePolishedSections(content: string): Record<string, string> | null {
  const want = ["OVERVIEW", "COMMUNICATION PATTERNS", "EVIDENCE STRENGTHS", "RISKS IN THE RECORD", "WHAT TO DOCUMENT NEXT"];
  const out: Record<string, string> = {};
  const lines = content.split("\n");
  let cur: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (cur) out[cur] = buf.join("\n").trim();
    buf.length = 0;
  };
  for (const ln of lines) {
    const m = ln.match(/^###\s*(.+)$/);
    if (m) {
      flush();
      cur = want.find((w) => m[1].trim().toUpperCase().startsWith(w.split(" ")[0])) || null;
      if (cur) cur = want.find((w) => m[1].trim().toUpperCase().startsWith(w)) || cur;
    } else if (cur) {
      buf.push(ln);
    }
  }
  flush();
  if (want.every((w) => out[w] && out[w].length > 20)) {
    const capped: Record<string, string> = {};
    want.forEach((w) => { capped[w] = out[w].slice(0, RR_MAX_SECTION_CHARS); });
    return capped;
  }
  return null;
}

async function polishSections(excerpt: string, llm: RecordReviewLLM): Promise<Record<string, string> | null> {
  if (!llm) return null;
  try {
    const res = await fetch(llm.base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + llm.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llm.model,
        stream: false,
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: "system", content: RR_SYSTEM_PROMPT },
          { role: "user", content: excerpt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const content = typeof j?.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content.trim() : "";
    return content ? parsePolishedSections(content) : null;
  } catch {
    return null; // provider slow/down — deterministic sections always work
  }
}

// Bounded excerpt for the LLM: the deterministic findings + truncated recent data.
function buildExcerpt(f: RRFindings, input: RecordReviewInput): string {
  const parts: string[] = [];
  parts.push("FINDINGS (deterministic, ground truth):");
  parts.push(JSON.stringify({
    counts: f.counts,
    datedLog: f.datedLog,
    datedTimeline: f.datedTimeline,
    span: f.span ? { earliest: f.span.earliest, latest: f.span.latest } : null,
    toneMix: f.toneMix,
    asWrote: f.asWrote,
    reviewedLogs: f.reviewedLogs,
    cadence: f.cadence,
    reviewScores: f.reviewScores,
    flaggedReviews: f.flaggedReviews,
    flaggedReviewNotes: f.flaggedReviewNotes,
    docs: f.docs,
    gaps: f.gaps,
    undated: f.undated,
    topics: f.topics,
    cats: f.cats,
    hasCaseSummary: f.hasCaseSummary,
  }));
  const log = (Array.isArray(input.log) ? input.log : []).slice(0, 40);
  const timeline = (Array.isArray(input.timeline) ? input.timeline : []).slice(0, 25);
  const files = (Array.isArray(input.files) ? input.files : []).slice(0, 25);
  const reviews = (Array.isArray(input.reviews) ? input.reviews : []).slice(0, 10);
  parts.push("LOG (" + log.length + " of " + f.counts.log + " shown):");
  if (!log.length) parts.push("(none)");
  log.forEach((l: any) => {
    parts.push("- [" + (l?.date || "no date") + "] " + (l?.direction === "received" ? "received" : "sent") + (l?.topic ? ", topic: " + l.topic : "") + (l?.tone && TONE_DISPLAY[l.tone] ? ", tone: " + TONE_DISPLAY[l.tone] : "") + " — " + rrOneLine(l?.message, 200));
  });
  parts.push("TIMELINE (" + timeline.length + " of " + f.counts.timeline + " shown):");
  if (!timeline.length) parts.push("(none)");
  timeline.forEach((t: any) => {
    parts.push("- [" + (t?.date || "no date") + "] " + (t?.category || "other") + " — " + rrOneLine(t?.title, 120) + (t?.details ? ": " + rrOneLine(t.details, 200) : ""));
  });
  parts.push("DOCUMENTS (" + files.length + " of " + f.counts.files + " shown):");
  if (!files.length) parts.push("(none)");
  files.forEach((d: any) => {
    parts.push("- folder: " + (d?.folder || "other") + " — " + rrOneLine(d?.title || d?.summary || d?.description || "document", 100) + (d?.summary ? " — " + rrOneLine(d.summary, 150) : "") + (Array.isArray(d?.tags) && d.tags.length ? " — tags: " + d.tags.slice(0, 5).join(", ") : ""));
  });
  parts.push("SAVED REVIEWS (" + reviews.length + " of " + f.counts.reviews + " shown):");
  if (!reviews.length) parts.push("(none)");
  reviews.forEach((r: any) => {
    const s = computeImpactScore(Array.isArray(r?.blocks) ? r.blocks : []);
    parts.push("- [" + (r?.createdAt ? rrDate(r.createdAt) : "no date") + "] score " + s.score + "/100, risks " + s.flags.risks + ", caution " + s.flags.watchout + " — draft: " + rrOneLine(r?.draft, 160));
  });
  return parts.join("\n").slice(0, RR_MAX_EXCERPT_CHARS);
}

// ---- HTML assembly ----------------------------------------------------------
function rrCss(): string {
  return "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf7ef;color:#2a2a28;line-height:1.55}.wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}.cover{border-bottom:2px solid #1f3d2b;padding-bottom:20px;margin-bottom:28px}h1{font-size:26px;color:#1f3d2b;margin:0 0 6px}h2{font-size:19px;color:#1f3d2b;margin:36px 0 2px}.sub{color:#6b6b62;font-size:14px;margin:4px 0}.honest{background:#1f3d2b;color:#faf7ef;border-radius:10px;padding:12px 14px;font-size:13px;margin:14px 0}.note{background:#f1ece0;border-radius:10px;padding:12px 14px;font-size:13px;color:#6b6b62;margin:10px 0}.card{border:1px solid #e5e0d4;border-radius:14px;padding:16px 18px;margin:10px 0;background:#fff}.label{font-size:11px;font-weight:700;letter-spacing:.06em;color:#1f3d2b;text-transform:uppercase;margin:12px 0 2px}.txt{white-space:pre-wrap;font-size:14.5px;margin:4px 0}.count{color:#6b6b62;font-size:13px;margin:0 0 12px}.empty{color:#6b6b62;font-style:italic;font-size:14px}@media print{body{background:#fff}.card{break-inside:avoid}}";
}

export async function buildRecordReview(input: RecordReviewInput, llm: RecordReviewLLM): Promise<RecordReviewResult> {
  const f = analyzeRecord(input);
  const generatedIso = new Date().toISOString();
  const generatedAt = rrDate(generatedIso);

  // LLM polish when healthy; deterministic always.
  let sections: Record<string, string> | null = null;
  let fallback = true;
  if (llm && f.total > 0) {
    const polished = await polishSections(buildExcerpt(f, input), llm);
    if (polished) {
      sections = polished;
      fallback = false;
    }
  }
  const s = sections || {
    OVERVIEW: detOverview(f),
    "COMMUNICATION PATTERNS": detPatterns(f),
    "EVIDENCE STRENGTHS": detStrengths(f),
    "RISKS IN THE RECORD": detRisks(f),
    "WHAT TO DOCUMENT NEXT": detNext(f),
  };
  // Fallback overview carries the honest quick-version note (the LLM path does
  // not need it — the polished prose is a full read).
  const overview = sections ? s.OVERVIEW : detOverview(f);

  const name = ((input.user?.profile?.name as string) || "").trim();
  const email = input.user?.email || "";
  const c = f.counts;

  let html = "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>Record Review — Before You Send</title><style>";
  html += rrCss();
  html += "</style></head><body><div class=\"wrap\">";

  html += '<div class="cover"><h1>Record Review</h1>';
  html += '<p class="sub">Prepared for ' + rrEsc(name || "your account") + (email ? " · " + rrEsc(email) : "") + "</p>";
  html += '<p class="sub">Prepared ' + rrEsc(generatedAt) + " · What's inside: at a glance · communication patterns · evidence strengths · risks · what to document next.</p>";
  html += '<div class="honest">Prepared from your saved record — every line comes from what you\u2019ve stored in Before You Send, nothing is invented. Communication guidance, not legal advice. It has not been reviewed by an attorney.</div>';
  html += '<div class="note">' + c.log + " log entr" + (c.log === 1 ? "y" : "ies") + " · " + c.timeline + " timeline event" + (c.timeline === 1 ? "" : "s") + " · " + c.files + " organizer document" + (c.files === 1 ? "" : "s") + " · " + c.reviews + " saved review" + (c.reviews === 1 ? "" : "s") + "</div>";
  if (f.total === 0) html += '<div class="note">Nothing is saved yet. This review will fill in as you log messages, add timeline events, and file documents.</div>';
  html += "</div>";

  const sectionCards: [string, string][] = [
    ["1 · At a glance", overview],
    ["2 · Communication patterns", s["COMMUNICATION PATTERNS"]],
    ["3 · Evidence strengths", s["EVIDENCE STRENGTHS"]],
    ["4 · Risks in the record", s["RISKS IN THE RECORD"]],
    ["5 · What to document next", s["WHAT TO DOCUMENT NEXT"]],
  ];
  sectionCards.forEach(([title, body]) => {
    html += "<h2>" + rrEsc(title) + "</h2>";
    html += '<div class="card"><div class="txt">' + rrEsc(body) + "</div></div>";
  });

  html += '<div class="honest">Prepared from your record — communication guidance, not legal advice. Generated by Before You Send on ' + rrEsc(generatedAt) + ".</div></div></body></html>";

  const filename = "Record-Review-" + generatedIso.slice(0, 10) + ".html";
  return { html, filename, fallback, generatedAt: generatedIso };
}
