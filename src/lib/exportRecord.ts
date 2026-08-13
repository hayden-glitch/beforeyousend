// Shared "Download your record" helper (owner-batch DESIGN 2): the exact
// dashboard exportRecord logic (home.tsx L339-362) extracted so the user menu
// and /account can reuse it without triplicating the fetch/blob/download dance.
// The API is tier-gated server-side (/api/export, Command/Ultimate only) — the
// client gates the button and the server enforces it. Returns null on success
// or a calm error message; analytics events reuse the existing export_* naming
// convention (export_started / export_downloaded / export_failed).

import { track } from "./analytics";

export async function downloadRecord(plan: string): Promise<string | null> {
  track("export_started", { plan });
  try {
    const r = await fetch("/api/export", { method: "GET" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Couldn't prepare your record right now.");
    }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^";]+)"?/);
    const fname = m ? m[1] : "Before-You-Send-Record.html";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    track("export_downloaded", { plan });
    return null;
  } catch (e) {
    track("export_failed", { plan });
    return e instanceof Error && e.message
      ? e.message
      : "Couldn't prepare your record right now — please try again.";
  }
}
