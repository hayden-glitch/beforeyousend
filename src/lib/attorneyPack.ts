// Attorney Prep Pack — Stage 2 DELIVERABLE (2026-08-12).
// Server-side assembly of a self-contained HTML pack from the dad's OWN record:
//   (a) cover sheet — user, case stage (if set), generation date, honest footer
//   (b) chronological case narrative — Timeline + Log in date order with
//       category/kind and one-line summaries; LLM-polished prose when the
//       provider is healthy, fully deterministic assembly always available
//   (c) evidence/document index — Organizer files (filename, folder, tags,
//       summary); honest note when there are no documents
//   (d) communication-pattern summary — deterministic, from Log tones
//       (TONE_DISPLAY) + saved reviews (impactScore): tone mix, escalation
//       flags, response cadence
//   (e) the full record export bundled (reuses buildExportSectionsHtml)
// Honesty: every line traces to actual saved data or is clearly generic
// guidance. The required footer "Prepared from your record — communication
// guidance, not legal advice." appears on the cover and at the end. No
// attorney-review or legal-advice implication anywhere.

import { expDate, expEsc, buildExportSectionsHtml, exportPackCss } from "./exportPack";
import { computeImpactScore } from "./impactScore";
import { TONE_DISPLAY } from "./toneLabels";

export type AttorneyPackLLM = { base: string; key: string; model: string } | null;

export type AttorneyPackInput = {
  user: any;
  reviews: any[];
  log: any[];
  timeline: any[];
  files: any[];
  caseSummary: any | null;
};

export type AttorneyPackResult = { html: string; filename: string; fallback: boolean };

const AP_MAX_EXCERPT_CHARS = 24000;
const AP_MAX_NARRATIVE_CHARS = 4000;

function apTruncate(s: unknown, n: number): string {
  const t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// One-line summary: collapse whitespace + truncate (the "one-line summaries"
// in the chronology spec).
function apOneLine(s: unknown, n: number): string {
  return apTruncate(String(s == null ? "" : s).replace(/\s+/g, " ").trim(), n);
}

function apTitleCase(s: string): string {
  return s.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function apDayNum(d: unknown): number {
  const m = String(d == null ? "" : d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return NaN;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(dt.getTime()) ? NaN : dt.getTime();
}

// Merge Timeline + Log into one date-ordered chronology (oldest first). Entries
// without a date sort last (stable, by kind) — the record still shows.
type ChronoItem = {
  date: string;
  day: number;
  kind: "event" | "log";
  label: string;        // category (events) or Sent/Received (log)
  title: string;        // event title or topic
  text: string;         // event details or message
  tone?: string;
};

function buildChronology(log: any[], timeline: any[]): ChronoItem[] {
  const items: ChronoItem[] = [];
  (timeline || []).forEach((t: any) => {
    items.push({
      date: t?.date || "",
      day: apDayNum(t?.date),
      kind: "event",
      label: apTitleCase(String(t?.category || "other").replace(/-/g, " ")),
      title: apOneLine(t?.title, 120) || "Untitled event",
      text: apOneLine(t?.details, 220),
    });
  });
  (log || []).forEach((l: any) => {
    items.push({
      date: l?.date || "",
      day: apDayNum(l?.date),
      kind: "log",
      label: l?.direction === "sent" ? "Sent by me" : "Received from co-parent",
      title: apTitleCase(String(l?.topic || "Other").replace(/-/g, " ")),
      text: apOneLine(l?.message, 220),
      tone: l?.tone,
    });
  });
  items.sort((a, b) => {
    if (a.date && b.date && a.day !== b.day) return a.day - b.day;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
    return 0;
  });
  return items;
}

// Bounded excerpt of the chronology + documents + review flags for the LLM
// polish pass (same shape philosophy as gatherCaseData — bounded, truncated).
function buildNarrativeExcerpt(items: ChronoItem[], files: any[]): string {
  const parts: string[] = [];
  parts.push("CHRONOLOGY (" + items.length + " entries, oldest first):");
  if (!items.length) parts.push("(none)");
  items.slice(0, 120).forEach((it) => {
    parts.push("- [" + (it.date || "no date") + "] " + it.kind + " — " + it.label + " — " + (it.text ? it.title + ": " + it.text : it.title));
  });
  parts.push("DOCUMENTS (" + files.length + "):");
  if (!files.length) parts.push("(none)");
  files.slice(0, 40).forEach((d: any) => {
    parts.push("- folder: " + (d.folder || "other") + " — " + apTruncate(d.title || d.summary || d.description || "document", 100) + (d.summary ? " — " + apTruncate(d.summary, 160) : ""));
  });
  return parts.join("\n").slice(0, AP_MAX_EXCERPT_CHARS);
}

const AP_NARRATIVE_SYSTEM_PROMPT = `You are "Before You Send", a calm, practical organizing assistant for a father in a co-parenting or custody situation. Below is a bounded excerpt of HIS OWN saved record (chronology and document list). Write a short "case chronology" narrative (plain prose paragraphs, max 300 words) that:
- Opens with what the saved record spans (earliest date to latest, and how many timeline events and log entries it holds).
- Then walks the timeline in date order, one or two sentences per meaningful entry, naming the event type (e.g. court, exchange, school) or message direction.
- Mentions ONLY things that actually appear in the excerpt. Never invent names, dates, events, messages, or documents.
- Stays calm, factual, neutral, and brief. NEVER give legal advice, never predict outcomes, never say what a judge or attorney would do or think.
- No headers, no bullets — just paragraphs.

Father's saved records:
`;

async function polishNarrative(excerpt: string, llm: AttorneyPackLLM): Promise<string | null> {
  if (!llm) return null;
  try {
    const res = await fetch(llm.base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + llm.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llm.model,
        stream: false,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: AP_NARRATIVE_SYSTEM_PROMPT },
          { role: "user", content: excerpt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const content = typeof j?.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content.trim() : "";
    return content ? content.slice(0, AP_MAX_NARRATIVE_CHARS) : null;
  } catch {
    return null; // provider slow/down — the deterministic narrative always works
  }
}

// Deterministic narrative: honest quick-mode wording + the real data list. The
// list below (buildChronology) is ALWAYS rendered regardless of polish.
function deterministicNarrative(items: ChronoItem[], logCount: number, timelineCount: number): string {
  const dated = items.filter((i) => !!i.date);
  if (!items.length) {
    return "Nothing is saved in your Event Timeline or Communication Log yet — add entries and regenerate the pack to build the chronology.";
  }
  if (!dated.length) {
    return "Your record holds " + timelineCount + " timeline event" + (timelineCount === 1 ? "" : "s") + " and " + logCount + " log entr" + (logCount === 1 ? "y" : "ies") + ", but none of them have dates yet — add dates to entries and regenerate for a dated chronology. Everything below is still from your actual saved record.";
  }
  const span = expDate(dated[0].date) + " through " + expDate(dated[dated.length - 1].date);
  return "Your record currently holds " + timelineCount + " timeline event" + (timelineCount === 1 ? "" : "s") + " and " + logCount + " log entr" + (logCount === 1 ? "y" : "ies") + ", spanning " + span + ". The narrative engine is briefly busy, so this is the quick version — every entry below is from your actual saved record, in date order.";
}

// Communication-pattern summary — fully deterministic. Tone mix from
// TONE_DISPLAY, escalation flags from tones + impactScore on saved reviews,
// response cadence from dated received→sent pairs.
function responseGaps(log: any[]): { gaps: number[]; pairs: number } {
  const dated = (log || [])
    .map((l: any) => ({ day: apDayNum(l?.date), dir: l?.direction }))
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
  return { gaps, pairs: gaps.length };
}

function median(nums: number[]): number {
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function buildCommunicationPattern(log: any[], reviews: any[]): { parts: string[]; flags: string[] } {
  const parts: string[] = [];
  const flags: string[] = [];
  const sent = (log || []).filter((l: any) => l?.direction === "sent").length;
  const received = (log || []).filter((l: any) => l?.direction === "received").length;

  if (!log.length) {
    parts.push("No log entries yet — tone mix and response patterns will build as you log messages.");
    return { parts, flags };
  }

  parts.push(sent + " sent by you · " + received + " received from co-parent");

  const toneCounts: Record<string, number> = {};
  (log || []).forEach((l: any) => {
    if (l?.tone && TONE_DISPLAY[l.tone]) toneCounts[l.tone] = (toneCounts[l.tone] || 0) + 1;
  });
  const toneKeys = Object.keys(toneCounts).sort();
  if (toneKeys.length) {
    parts.push("Tone mix: " + toneKeys.map((t) => TONE_DISPLAY[t] + " " + toneCounts[t]).join(" · "));
  }

  // Escalation flags — honest, from tones + saved-review impact scores only.
  const asWrote = toneCounts["as-wrote"] || 0;
  const reviewed = toneCounts["reviewed"] || 0;
  if (asWrote > 0) {
    flags.push(asWrote + (asWrote === 1 ? " message was sent as originally written — no calm pass." : " messages were sent as originally written — no calm pass."));
  }
  if (reviewed > 0) {
    flags.push(reviewed + (reviewed === 1 ? " message was run through a calm review before sending." : " messages were run through a calm review before sending."));
  }
  const flaggedReviews = (reviews || []).filter((r: any) => {
    const s = computeImpactScore(Array.isArray(r?.blocks) ? r.blocks : []);
    return s.flags.risks > 0 || s.flags.watchout > 0;
  });
  if (flaggedReviews.length) {
    flags.push(flaggedReviews.length + (flaggedReviews.length === 1 ? " saved review flagged conflict signals." : " saved reviews flagged conflict signals."));
  }
  if (!flags.length) {
    flags.push("No escalation flags in the saved record — no messages logged as sent as-written, and no saved reviews with conflict signals.");
  }

  // Response cadence.
  const { gaps, pairs } = responseGaps(log);
  if (pairs >= 2) {
    parts.push("Median response time to co-parent messages: " + median(gaps) + (median(gaps) === 1 ? " day" : " days") + " (from " + pairs + " dated exchange" + (pairs === 1 ? "" : "s") + ").");
  } else if (pairs === 1) {
    parts.push("Not enough dated exchanges to measure a response pattern yet — keep logging and it will show up here.");
  } else {
    parts.push("Not enough dated exchanges to measure response time yet.");
  }

  return { parts, flags };
}

function buildDocumentIndexHtml(files: any[]): string {
  let html = "";
  if (!files.length) {
    html += '<p class="empty">No documents in your Organizer yet. Add screenshots, bills, or messages and regenerate the pack to build the evidence index.</p>';
    return html;
  }
  const sorted = (files || []).slice().sort((a: any, b: any) => String(a.folder || "other").localeCompare(String(b.folder || "other")));
  sorted.forEach((f: any) => {
    const folder = f.folder ? apTitleCase(String(f.folder).replace(/-/g, " ")) : "Other";
    const cat = f.category ? apTitleCase(String(f.category).replace(/-/g, " ")) : "";
    html += '<div class="card"><p class="meta">' + expEsc(folder) + (cat ? " › " + expEsc(cat) : "") + " · " + (f.kind === "image" ? "Photo, screenshot, or PDF" : "Pasted text") + (f.createdAt ? " · " + expEsc(expDate(f.createdAt)) : "") + "</p>";
    html += '<p class="txt"><strong>' + expEsc(f.title || (f.kind === "text" ? "Pasted text" : "Untitled document")) + "</strong></p>";
    if (f.summary) html += '<p class="label">Summary</p><p class="txt">' + expEsc(f.summary) + "</p>";
    if (f.kind !== "text" && f.description) html += '<p class="label">Description</p><p class="txt">' + expEsc(f.description) + "</p>";
    if (Array.isArray(f.tags) && f.tags.length) html += '<p class="tags">Tags: ' + expEsc(f.tags.join(", ")) + "</p>";
    html += "</div>";
  });
  return html;
}

// The extra CSS on top of the shared export CSS: cover sheet, numbered
// sections, pattern chips — same forest/cream visual language.
function packCss(): string {
  return ".cover{border-bottom:2px solid #1f3d2b;padding-bottom:20px;margin-bottom:28px}h1{font-size:26px;color:#1f3d2b;margin:0 0 6px}h2{font-size:19px;color:#1f3d2b;margin:36px 0 2px}h3{font-size:15px;color:#1f3d2b;margin:18px 0 2px}.sub{color:#6b6b62;font-size:14px;margin:4px 0}.honest{background:#1f3d2b;color:#faf7ef;border-radius:10px;padding:12px 14px;font-size:13px;margin:14px 0}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{display:inline-block;border:1px solid #e5e0d4;border-radius:999px;padding:3px 10px;font-size:12.5px;color:#2a2a28;background:#fff}.flag{color:#7a3b2e}@media print{body{background:#fff}.card{break-inside:avoid}}";
}

export async function buildAttorneyPack(input: AttorneyPackInput, llm: AttorneyPackLLM): Promise<AttorneyPackResult> {
  const { user, reviews, log, timeline, files, caseSummary } = input;
  const generatedIso = new Date().toISOString();
  const generatedAt = expDate(generatedIso);
  const name = (user?.profile?.name || "").trim();
  const caseStage = (user?.profile?.caseStage || "").trim();
  const email = user?.email || "";

  // (b) chronology + narrative
  const items = buildChronology(log, timeline);
  let narrative = deterministicNarrative(items, (log || []).length, (timeline || []).length);
  let fallback = true;
  if (llm && items.length) {
    const excerpt = buildNarrativeExcerpt(items, files);
    const polished = await polishNarrative(excerpt, llm);
    if (polished) {
      narrative = polished;
      fallback = false;
    }
  }

  // (d) communication patterns
  const pattern = buildCommunicationPattern(log, reviews);

  const totalEntries = (log || []).length + (timeline || []).length + (files || []).length + (reviews || []).length;

  let html = "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>Attorney Prep Pack — Before You Send</title><style>";
  html += "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf7ef;color:#2a2a28;line-height:1.55}.wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}";
  html += packCss() + exportPackCss();
  html += "</style></head><body><div class=\"wrap\">";

  // (a) cover sheet
  html += '<div class="cover"><h1>Attorney Prep Pack</h1>';
  html += '<p class="sub">Prepared for ' + expEsc(name || "your account") + (email ? " · " + expEsc(email) : "") + "</p>";
  html += '<p class="sub">Prepared ' + expEsc(generatedAt) + " · Case stage: " + expEsc(caseStage || "Not set") + "</p>";
  html += '<p class="sub">What\u2019s inside: cover sheet · case chronology · evidence index · communication patterns · your full record.</p>';
  html += '<div class="honest">Prepared from your record — communication guidance, not legal advice. Every line in this pack comes from what you\u2019ve saved in Before You Send; nothing is invented. It has not been reviewed by an attorney.</div>';
  html += '<div class="note">' + (log || []).length + " log entr" + ((log || []).length === 1 ? "y" : "ies") + " · " + (timeline || []).length + " timeline event" + ((timeline || []).length === 1 ? "" : "s") + " · " + (files || []).length + " organizer document" + ((files || []).length === 1 ? "" : "s") + " · " + (reviews || []).length + " saved review" + ((reviews || []).length === 1 ? "" : "s") + "</div>";
  if (totalEntries === 0) html += '<div class="note">Nothing is saved yet. This pack will fill in as you log messages, add timeline events, and file documents.</div>';
  html += "</div>";

  // (b) chronological case narrative
  html += '<h2>1 · Case Chronology</h2>';
  html += '<div class="card"><div class="txt">' + expEsc(narrative) + "</div></div>";
  html += '<h3>What happened, in date order</h3>';
  if (!items.length) {
    html += '<p class="empty">No timeline events or log entries yet.</p>';
  } else {
    items.forEach((it) => {
      html += '<div class="card"><p class="meta">' + expEsc(expDate(it.date) || "No date") + " · " + expEsc(it.kind === "event" ? "Event — " + it.label : it.label + " — " + it.title) + (it.tone && TONE_DISPLAY[it.tone] ? " · " + expEsc(TONE_DISPLAY[it.tone]) : "") + "</p>";
      html += '<p class="txt">' + (it.kind === "event" ? "<strong>" + expEsc(it.title) + "</strong>" : expEsc(it.title)) + (it.text ? " — " + expEsc(it.text) : "") + "</p></div>";
    });
  }

  // (c) evidence / document index
  html += '<h2>2 · Evidence &amp; Document Index</h2>';
  html += buildDocumentIndexHtml(files);

  // (d) communication-pattern summary
  html += '<h2>3 · Communication Patterns</h2>';
  html += '<div class="card">';
  if (!pattern.parts.length && !pattern.flags.length) {
    html += '<p class="txt">No log entries yet — patterns will build as you log messages.</p>';
  } else {
    if (pattern.parts.length) html += '<p class="label">What the log shows</p><p class="txt">' + expEsc(pattern.parts.join("\n")) + "</p>";
    if (pattern.flags.length) {
      html += '<p class="label">Worth watching</p>';
      html += '<div class="chips">' + pattern.flags.map((f) => '<span class="chip flag">' + expEsc(f) + "</span>").join("") + "</div>";
    }
  }
  html += "</div>";

  // (e) full record export (reuses the export assembly)
  html += '<h2>4 · Your Full Record</h2>';
  html += '<div class="note">Everything you\u2019ve saved, in one place — the same content as the Export pack from your Command Center.</div>';
  html += buildExportSectionsHtml(reviews, log, timeline, files, caseSummary, generatedAt, "From your Attorney Prep Pack, generated " + expEsc(generatedAt) + ". This is your own saved record — nothing more, nothing less.");

  html += '<div class="honest">Prepared from your record — communication guidance, not legal advice. Generated by Before You Send on ' + expEsc(generatedAt) + ".</div></div></body></html>";

  const filename = "Attorney-Prep-Pack-" + generatedIso.slice(0, 10) + ".html";
  return { html, filename, fallback };
}
