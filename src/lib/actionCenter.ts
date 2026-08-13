// Action Center client lib — GET loads the persisted "what needs your
// attention" list (or null) with the current record counts; POST
// generates/regenerates it from the user's OWN saved data (Communication Log,
// Event Timeline, Organizer documents, saved reviews, Case Summary). Command
// Center tier feature — the server enforces the gate (402, same as the
// Document Organizer). No "AI" in user copy.

export type ActionCenterCounts = { log: number; timeline: number; docs: number; reviews: number };
// section: unresolved | upcoming | missing | needs_documentation
// actionType: "tab" → a real button that jumps to the named tab (ref);
//             "copy" → just an honest suggested next step (no wiring).
export type ActionItem = {
  id: string;
  section: "unresolved" | "upcoming" | "missing" | "needs_documentation";
  text: string;
  source: string;
  action: string;
  actionType: "tab" | "copy";
  ref?: string;
};
export type ActionCenterRow = { items: ActionItem[]; generatedAt: string; dataVersion: string };
export type ActionCenterData = {
  summary: ActionCenterRow | null;
  counts: ActionCenterCounts;
  empty?: boolean;
  fallback?: boolean;
  stale?: boolean;
};
export type ActionCenterApiResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

async function acFetch(path: string, init?: RequestInit): Promise<ActionCenterApiResult<unknown>> {
  let r: Response;
  try {
    r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    return { ok: false, error: "Couldn't reach the Action Center right now — please try again." };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof j?.error === "string" ? j.error : "Couldn't reach the Action Center right now — please try again.";
    if (r.status === 402) return { ok: false, error: "The Action Center is part of the Command Center plan." };
    if (r.status === 401) return { ok: false, error: "Please sign in again." };
    return { ok: false, error: msg };
  }
  return { ok: true, value: j };
}

export async function fetchActionCenter(): Promise<ActionCenterApiResult<ActionCenterData>> {
  const r = await acFetch("/api/action-center");
  return r.ok ? { ok: true, value: r.value as ActionCenterData } : r;
}

export async function generateActionCenter(): Promise<ActionCenterApiResult<ActionCenterData>> {
  const r = await acFetch("/api/action-center", { method: "POST" });
  return r.ok ? { ok: true, value: r.value as ActionCenterData } : r;
}
