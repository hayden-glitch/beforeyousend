// Shared self-contained record export assembly — the exact sections rendered by
// /api/export (Command Center "Export your record") extracted (2026-08-12) so
// the Attorney Prep Pack can embed the SAME full-record sections (spec: "reuse
// the existing export assembly"). handleExport keeps the entitlement gate and
// the outer header; this module owns the note + all section HTML + the CSS.
// Honesty invariant: every line traces to the dad's OWN saved rows or is a
// clear empty-state — nothing fabricated, no legal/admissibility claims.

import { computeImpactScore } from "./impactScore";

export const EXPORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const EXPORT_TONES: Record<string, string> = { gentle: "Gentle", direct: "Direct", firm: "Firm but Neutral", neutral: "Neutral" };

// "2026-08-12" -> "Aug 12, 2026"; anything else passes through.
export function expDate(d: unknown): string {
  if (!d) return "";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  const mon = EXPORT_MONTHS[(Number(m[2]) - 1 + 12) % 12];
  return mon + " " + Number(m[3]) + ", " + m[1];
}

export function expEsc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function expBlocksHtml(blocks: any[]): string {
  if (!Array.isArray(blocks) || !blocks.length) return "";
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] || {};
    if (b.kind === "section" || b.kind === "rewrite") out.push('<p class="label">' + expEsc(b.title) + "</p>");
    else if (b.kind === "para" || b.kind === "item" || b.kind === "rwtext") out.push('<p class="txt">' + expEsc(b.text) + "</p>");
  }
  return out.join("\n");
}

// The <style> content shared by every self-contained record file.
export function exportPackCss(): string {
  return "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf7ef;color:#2a2a28;line-height:1.55}.wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}header{border-bottom:2px solid #1f3d2b;padding-bottom:20px;margin-bottom:28px}h1{font-size:26px;color:#1f3d2b;margin:0 0 6px}.sub{color:#6b6b62;font-size:14px;margin:4px 0}h2{font-size:19px;color:#1f3d2b;margin:36px 0 2px}.count{color:#6b6b62;font-size:13px;margin:0 0 12px}.card{border:1px solid #e5e0d4;border-radius:14px;padding:16px 18px;margin:10px 0;background:#fff}.meta{color:#6b6b62;font-size:12.5px;margin:0}.label{font-size:11px;font-weight:700;letter-spacing:.06em;color:#1f3d2b;text-transform:uppercase;margin:12px 0 2px}.txt{white-space:pre-wrap;font-size:14.5px;margin:4px 0}.note{background:#f1ece0;border-radius:10px;padding:12px 14px;font-size:13px;color:#6b6b62;margin:10px 0}.empty{color:#6b6b62;font-style:italic;font-size:14px}.tags{font-size:12.5px;color:#6b6b62}@media print{body{background:#fff}.card{break-inside:avoid}}";
}

// The counts note + all section HTML (Case Summary, Saved Reviews, Communication
// Log, Event Timeline, Organizer Documents) + the closing footer note. Used by
// /api/export directly and embedded as section (e) of the Attorney Prep Pack.
export function buildExportSectionsHtml(
  reviews: any[],
  log: any[],
  timeline: any[],
  files: any[],
  cs: any | null,
  generatedAt: string,
  footerNote?: string
): string {
  let html = "";
  const total = reviews.length + log.length + timeline.length + files.length + (cs && cs.text ? 1 : 0);
  html += '<div class="note">' + reviews.length + " saved review" + (reviews.length === 1 ? "" : "s") + " · " + log.length + " log entr" + (log.length === 1 ? "y" : "ies") + " · " + timeline.length + " timeline event" + (timeline.length === 1 ? "" : "s") + " · " + files.length + " organizer document" + (files.length === 1 ? "" : "s") + (cs && cs.text ? " · Case summary: yes" : "") + "</div>";
  if (total === 0) html += '<div class="note">Nothing saved yet. This file will fill in as you save reviews, log entries, and documents.</div>';
  html += "<h2>Case Summary</h2>";
  if (cs && cs.text) html += '<p class="count">Generated ' + expEsc(expDate(cs.generatedAt)) + '</p><div class="card"><div class="txt">' + expEsc(cs.text) + "</div></div>";
  else html += '<p class="empty">No case summary yet.</p>';
  html += "<h2>Saved Reviews</h2>";
  if (!reviews.length) html += '<p class="empty">No entries yet.</p>';
  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    const score = computeImpactScore(Array.isArray(r.blocks) ? r.blocks : []).score;
    html += '<div class="card"><p class="meta">' + expEsc(expDate(r.createdAt)) + " · Message Impact Score " + score + "/100</p>";
    html += '<p class="label">Your message</p><p class="txt">' + expEsc(r.draft) + "</p>";
    const bh = expBlocksHtml(r.blocks);
    html += bh ? '<p class="label">Review</p>' + bh : (r.review ? '<p class="label">Review</p><p class="txt">' + expEsc(r.review) + "</p>" : "");
    html += "</div>";
  }
  html += "<h2>Communication Log</h2>";
  if (!log.length) html += '<p class="empty">No entries yet.</p>';
  for (let j = 0; j < log.length; j++) {
    const l = log[j];
    html += '<div class="card"><p class="meta">' + expEsc(expDate(l.date)) + " · " + (l.direction === "sent" ? "Sent by me" : "Received from co-parent") + " · " + expEsc(l.topic || "other") + (l.tone && l.tone !== "reviewed" ? " · " + expEsc(EXPORT_TONES[l.tone] || l.tone) : "") + '</p><p class="txt">' + expEsc(l.message) + "</p>";
    if (l.notes) html += '<p class="label">Private notes</p><p class="txt">' + expEsc(l.notes) + "</p>";
    html += "</div>";
  }
  html += "<h2>Event Timeline</h2>";
  if (!timeline.length) html += '<p class="empty">No entries yet.</p>';
  for (let k = 0; k < timeline.length; k++) {
    const t = timeline[k];
    html += '<div class="card"><p class="meta">' + expEsc(expDate(t.date)) + " · " + expEsc(String(t.category || "other").replace(/-/g, " ")) + '</p><p class="txt"><strong>' + expEsc(t.title) + "</strong></p>";
    if (t.details) html += '<p class="txt">' + expEsc(t.details) + "</p>";
    html += "</div>";
  }
  html += "<h2>Organizer Documents</h2>";
  if (!files.length) html += '<p class="empty">No entries yet.</p>';
  for (let m = 0; m < files.length; m++) {
    const f = files[m];
    const folder = f.folder ? String(f.folder).replace(/-/g, " ") : "";
    const cat = f.category ? String(f.category).replace(/-/g, " ") : "";
    html += '<div class="card"><p class="meta">' + (f.kind === "image" ? "Photo, screenshot, or PDF" : "Pasted text") + (f.createdAt ? " · " + expEsc(expDate(f.createdAt)) : "") + (folder ? " · " + expEsc(folder) + (cat ? " › " + expEsc(cat) : "") : "") + "</p>";
    html += '<p class="txt"><strong>' + expEsc(f.title || (f.kind === "text" ? "Pasted text" : "Untitled document")) + "</strong></p>";
    if (f.summary) html += '<p class="label">Summary</p><p class="txt">' + expEsc(f.summary) + "</p>";
    if (f.kind === "text" && f.content) html += '<p class="label">Text</p><p class="txt">' + expEsc(f.content) + "</p>";
    if (f.kind !== "text" && f.description) html += '<p class="label">Description</p><p class="txt">' + expEsc(f.description) + "</p>";
    if (f.reason) html += '<p class="label">Why it was filed here</p><p class="txt">' + expEsc(f.reason) + "</p>";
    if (Array.isArray(f.tags) && f.tags.length) html += '<p class="tags">Tags: ' + expEsc(f.tags.join(", ")) + "</p>";
    html += "</div>";
  }
  html += '<div class="note">' + (footerNote || "Downloaded from your Before You Send account on " + expEsc(generatedAt) + ". This file contains your own saved records — nothing more, nothing less.") + "</div>";
  return html;
}
