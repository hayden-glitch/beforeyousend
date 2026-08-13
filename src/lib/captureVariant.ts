// Capture-card A/B (the FIRST measured A/B — conversion-plan-next-cycle.md §3):
// 50/50 arm assignment via a bys_capture_variant cookie. The variant is
// assigned once at review-results render (when the EmailCapture card mounts)
// and persisted for a year with the same attributes as the bys_checkin /
// bys_org_trial / bys_hero_variant cookies (Max-Age 31536000, Path=/, SameSite=Lax).
// It is read again at email_submitted so the email_captured funnel event can
// carry meta.variant per arm (persistEvent → /api/events keeps meta as-is).
export type CaptureVariant = "a" | "b";

const COOKIE = "bys_capture_variant";

export function readCaptureVariant(): CaptureVariant | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)bys_capture_variant=([^;]+)/);
    return m && (m[1] === "a" || m[1] === "b") ? (m[1] as CaptureVariant) : null;
  } catch {
    return null;
  }
}

export function ensureCaptureVariant(): CaptureVariant {
  const existing = readCaptureVariant();
  if (existing) return existing;
  const v: CaptureVariant = Math.random() < 0.5 ? "a" : "b";
  try {
    document.cookie = `${COOKIE}=${v}; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    /* cookie unavailable — the in-memory variant is still returned */
  }
  return v;
}
