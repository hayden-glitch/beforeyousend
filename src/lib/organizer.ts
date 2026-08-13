// "The Organizer" promo client lib. Public name is "The Organizer" — "AI"
// appears nowhere in user-facing copy. Promo assignment happens in the
// index.tsx / __root.tsx head scripts (bys_org_trial cookie, 100% since
// 2026-08-12 D3 — every free dad sees the trial; data-organizer-promo attr on
// <html>); this module only READS it (default "off" → controls get nothing).

import { useState } from "react";
import { track } from "~/lib/analytics";

export function useOrganizerPromo(): "on" | "off" {
  const [v] = useState<"on" | "off">(() =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-organizer-promo") === "on"
      ? "on"
      : "off"
  );
  return v;
}

const MAX_RAW_BYTES = 2.5 * 1024 * 1024; // client-side raw-file cap (spec §2)
const MAX_EDGE = 1600; // longest edge after re-encode
const MAX_DATAURL_CHARS = 3_500_000; // matches the server cap

/**
 * Read an image file, EXIF-strip it (canvas re-encode to webp 0.8, longest
 * edge ≤ 1600px) and return a data URL for the trial API. Rejects HEIC with a
 * friendly message; rejects anything over the client cap. The canvas round-trip
 * drops GPS/location and all metadata — nothing private leaves the device
 * except the re-encoded pixels. PDFs pass through as-is (base64 data URL, same
 * 2.5 MB raw cap — the platform's request size limit makes larger uploads
 * unreliable, so the honest cap stays at ~2.5 MB for every file type).
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = (file.type || "").toLowerCase();
    const isPdf = t === "application/pdf" || /\.pdf$/i.test(file.name);
    if (file.size > MAX_RAW_BYTES) {
      reject(new Error("That file is over 2.5 MB — try a smaller screenshot, bill, or PDF."));
      return;
    }
    if (!isPdf && (/heic|heif/.test(t) || /heic|heif/i.test(file.name))) {
      reject(new Error("HEIC photos aren't supported yet — save it as a JPG or PNG first, or paste the text instead."));
      return;
    }
    if (!isPdf && !["image/png", "image/jpeg", "image/webp"].includes(t)) {
      reject(new Error("That file type isn't supported — use a JPG, PNG, or WebP image, or a PDF."));
      return;
    }
    if (isPdf) {
      // PDFs can't be re-encoded client-side — keep the raw base64 (the server
      // classifies by filename + description, same as screenshots).
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that file — please try again."));
      reader.onload = () => {
        const out = String(reader.result || "");
        if (!out || out.length > MAX_DATAURL_CHARS) {
          reject(new Error("That PDF is too large — try a smaller one (under 2.5 MB)."));
          return;
        }
        resolve(out);
      };
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file — please try again."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that image — please try another file."));
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Couldn't process that image — please try again."));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL("image/webp", 0.8);
          if (!out || out.length > MAX_DATAURL_CHARS) {
            reject(new Error("That image is too large — try a smaller screenshot or bill."));
            return;
          }
          resolve(out);
        } catch {
          reject(new Error("Couldn't process that image — please try again."));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export type OrganizerTrialInput = {
  kind: "text" | "image";
  text?: string;
  fileName?: string;
  dataUrl?: string;
  description?: string;
};

export type OrganizerTrialResult = {
  ok: boolean;
  result?: {
    folder: string;
    category: string;
    reason: string;
    summary?: string;
    tags?: string[];
    title?: string | null;
  };
  trial?: { used: boolean; remaining: number; count?: number };
  error?: string;
};

/** POST the trial item. The caller fires organizer_trial_started just before. */
export async function runOrganizerTrial(
  input: OrganizerTrialInput,
  promo: "on" | "off"
): Promise<OrganizerTrialResult> {
  let r: Response;
  try {
    r = await fetch("/api/organizer/trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, promo }),
    });
  } catch {
    return { ok: false, error: "Couldn't run the organizer demo right now — please try again." };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, error: typeof j?.error === "string" ? j.error : "Couldn't run the organizer demo right now — please try again." };
  }
  return j as OrganizerTrialResult;
}

/**
 * Upsell CTA → /pricing (LEAD RULING): fire organizer_upgrade_clicked +
 * checkout_started(plan=command) for measurement, then navigate. Deliberately
 * does NOT call recordSurface() — the Ultimate SpecialOffer modal stays out of
 * this path.
 */
export function startCommandCheckout(): void {
  track("organizer_upgrade_clicked", { plan: "command", interval: "month" });
  track("checkout_started", { plan: "command", interval: "month" });
  window.location.href = "/pricing";
}

// ---- Paid Organizer API (Command Center / Ultimate tiers) ----
// Mirrors the server handlers (src/lib/server-api.ts handleOrganizerFiles):
// GET list, POST create (classifies server-side), PATCH move, DELETE remove.
export type OrganizerFile = {
  id: string;
  kind: "text" | "image";
  title: string | null;
  content: string | null;
  dataUrl: string | null;
  description: string | null;
  folder: string;
  category: string;
  reason: string | null;
  summary: string | null;
  tags: string[] | null;
  trial: boolean;
  createdAt: string;
};

export type OrganizerApiResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

async function orgFetch(path: string, init?: RequestInit): Promise<OrganizerApiResult<unknown>> {
  let r: Response;
  try {
    r = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    return { ok: false, error: "Couldn't reach The Organizer right now — please try again." };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof j?.error === "string" ? j.error : "Couldn't reach The Organizer right now — please try again.";
    if (r.status === 402) return { ok: false, error: "The Document Organizer is part of the Command Center plan." };
    if (r.status === 401) return { ok: false, error: "Please sign in again." };
    return { ok: false, error: msg };
  }
  return { ok: true, value: j };
}

export async function fetchOrganizerFiles(): Promise<OrganizerApiResult<OrganizerFile[]>> {
  const r = await orgFetch("/api/organizer/files");
  return r.ok ? { ok: true, value: (r.value as { files: OrganizerFile[] }).files || [] } : r;
}

export async function createOrganizerFile(input: {
  kind: "text" | "image";
  text?: string;
  title?: string;
  dataUrl?: string;
  description?: string;
}): Promise<OrganizerApiResult<OrganizerFile>> {
  const r = await orgFetch("/api/organizer/files", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return r.ok ? { ok: true, value: (r.value as { file: OrganizerFile }).file } : r;
}

export async function moveOrganizerFile(id: string, folder: string, category: string): Promise<OrganizerApiResult<OrganizerFile>> {
  const r = await orgFetch(`/api/organizer/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ folder, category }),
  });
  return r.ok ? { ok: true, value: (r.value as { file: OrganizerFile }).file } : r;
}
export async function renameOrganizerFile(id: string, title: string): Promise<OrganizerApiResult<OrganizerFile>> {
  const r = await orgFetch(`/api/organizer/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return r.ok ? { ok: true, value: (r.value as { file: OrganizerFile }).file } : r;
}

/** Refile a "needs sorting" item: the dad adds one line of what it is; the
 *  server re-classifies with his description and persists the updated row. */
export async function refileOrganizerFile(id: string, description: string): Promise<OrganizerApiResult<OrganizerFile>> {
  const r = await orgFetch(`/api/organizer/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ refile: description }),
  });
  return r.ok ? { ok: true, value: (r.value as { file: OrganizerFile }).file } : r;
}

export async function removeOrganizerFile(id: string): Promise<OrganizerApiResult<boolean>> {
  const r = await orgFetch(`/api/organizer/files/${id}`, { method: "DELETE" });
  return r.ok ? { ok: true, value: true } : r;
}
